// Revisión por la dirección — API (Cloudflare Worker + Neon)
// Silver Industrial · ISO 9001, 9.3 · registros A.19 (agenda) y A.24 (minuta)
// Un solo rol: administrador (clave ADMIN_KEY, la misma que usan las demás apps del SGC).
// Guarda las revisiones (2023 en adelante), los valores de los indicadores por año, las acciones heredadas con su
// seguimiento y las decisiones. Además lee en vivo lo que ya cargan las otras apps (Contexto, Auditorías, RR.HH.).

import { neon } from '@neondatabase/serverless';

const DEFAULT_ORIGINS = ['https://diegortizdao-collab.github.io'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function secret(binding) {
  if (binding == null) return null;
  if (typeof binding === 'string') return binding;
  if (typeof binding.get === 'function') return await binding.get();
  return null;
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

async function requireAdmin(req, env) {
  const given = req.headers.get('X-Clave');
  const admin = await secret(env.ADMIN_KEY);
  if (!given || !admin || !(await safeEqual(given, admin))) throw new HttpError(401, 'Clave incorrecta.');
}

function corsHeaders(req, env) {
  const allowed = env.ALLOWED_ORIGINS ? String(env.ALLOWED_ORIGINS).split(',').map(s => s.trim()) : DEFAULT_ORIGINS;
  const origin = req.headers.get('Origin');
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Clave',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(req, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(req, env) },
  });
}

async function readBody(req) {
  try { return await req.json(); } catch { throw new HttpError(400, 'El cuerpo no es JSON válido.'); }
}

// ---------- definición de los registros ----------
// tipos: t = texto, d = fecha (AAAA-MM-DD), n = número, i = entero, b = booleano, e:[...] = lista cerrada
const E_EST_ACC = ['abierta', 'en curso', 'cumplida', 'descartada'];
const E_EST_DEC = ['propuesta', 'aprobada', 'en curso', 'cumplida', 'descartada'];
const REG = {
  revision:    { table: 'rxd_revisiones', key: ['anio'], stamp: true, order: 'anio',
                 cols: { fecha: 'd', titulo: 't', estado: ['borrador', 'cerrada'], archivo_url: 't' } },
  seccion:     { table: 'rxd_secciones', key: ['anio', 'nro'], stamp: true, order: 'anio, nro',
                 cols: { titulo: 't', texto: 't', origen: ['historico', 'borrador', 'editada'] } },
  valor:       { table: 'rxd_valores', key: ['clave', 'anio'], stamp: true, order: 'clave, anio',
                 cols: { valor: 'n', meta: 'n', parcial: 'b', nota: 't' } },
  auditoria:   { table: 'rxd_auditorias', key: ['anio', 'nro'], order: 'anio, nro',
                 cols: { tema: 't', auditor: 't', fecha: 't', nc: 'i', ha: 'i', om: 'i' } },
  reclamo:     { table: 'rxd_reclamos', key: ['anio', 'cliente'], order: 'anio, cliente', cols: { cantidad: 'i' } },
  accion:      { table: 'rxd_acciones', key: ['codigo'], stamp: true, order: 'origen_anio, codigo',
                 cols: { origen_anio: 'i', texto: 't', estado: E_EST_ACC, responsable: 't', fecha_limite: 'd', cerrada_anio: 'i' } },
  seguimiento: { table: 'rxd_seguimiento', key: ['codigo', 'anio'], order: 'codigo, anio', cols: { nota: 't' } },
  decision:    { table: 'rxd_decisiones', key: ['anio', 'codigo'], stamp: true, order: 'anio, length(codigo), codigo',
                 cols: { texto: 't', origen: 't', responsable: 't', fecha_limite: 'd', estado: E_EST_DEC } },
  entrada:     { table: 'rxd_entradas', key: ['anio', 'nro'], stamp: true, order: 'anio, nro',
                 cols: { titulo: 't', fuente: 't', origen: ['auto', 'mixto', 'manual', 'sin'], nota: 't' } },
};
const KEY_INT = new Set(['anio', 'nro']);

function clean(reg, col, v) {
  const t = reg.cols[col];
  if (v === '' || v == null) return null;
  if (Array.isArray(t)) {
    if (!t.includes(v)) throw new HttpError(400, `Valor inválido para ${col}.`);
    return v;
  }
  if (t === 'i') { const n = Number(v); if (!Number.isInteger(n)) throw new HttpError(400, `${col} debe ser un entero.`); return n; }
  if (t === 'n') { const n = Number(v); if (!Number.isFinite(n)) throw new HttpError(400, `${col} debe ser un número.`); return n; }
  if (t === 'b') return v === true || v === 'true' || v === 1;
  if (t === 'd') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new HttpError(400, `${col} debe ser una fecha AAAA-MM-DD.`); return String(v); }
  return String(v).slice(0, 60000);
}

function keyVals(reg, parts) {
  if (parts.length !== reg.key.length) throw new HttpError(400, 'Clave incompleta.');
  return reg.key.map((k, i) => {
    if (KEY_INT.has(k)) {
      const n = Number(parts[i]);
      if (!Number.isInteger(n)) throw new HttpError(400, `${k} inválido.`);
      return n;
    }
    return decodeURIComponent(parts[i]);
  });
}

async function log(sql, anio, registro, clave, campo, antes, despues) {
  await sql.query('insert into rxd_historial (anio, registro, clave, campo, antes, despues) values ($1,$2,$3,$4,$5,$6)',
    [anio, registro, clave, campo, antes == null ? null : String(antes).slice(0, 2000), despues == null ? null : String(despues).slice(0, 2000)]);
}

function dbError(e) {
  if (e && (e.code === '23502' || e.code === '23514' || e.code === '23503' || e.code === '22P02')) {
    throw new HttpError(400, 'Faltan datos o hay un valor fuera de lo permitido.');
  }
  throw e;
}

// ---------- importación de los históricos (data/historicos.json) ----------
const IMPORT = [
  ['revisiones', 'rxd_revisiones', ['anio', 'fecha', 'titulo', 'estado', 'archivo_url'], ['anio']],
  ['secciones', 'rxd_secciones', ['anio', 'nro', 'titulo', 'texto', 'origen'], ['anio', 'nro']],
  ['indicadores', 'rxd_indicadores', ['clave', 'nombre', 'unidad', 'direccion', 'grupo', 'orden', 'nota'], ['clave']],
  ['valores', 'rxd_valores', ['clave', 'anio', 'valor', 'meta', 'parcial', 'nota'], ['clave', 'anio']],
  ['auditorias', 'rxd_auditorias', ['anio', 'nro', 'tema', 'auditor', 'fecha', 'nc', 'ha', 'om'], ['anio', 'nro']],
  ['reclamos', 'rxd_reclamos', ['anio', 'cliente', 'cantidad'], ['anio', 'cliente']],
  ['acciones', 'rxd_acciones', ['codigo', 'origen_anio', 'texto', 'estado', 'responsable', 'fecha_limite', 'cerrada_anio'], ['codigo']],
  ['seguimiento', 'rxd_seguimiento', ['codigo', 'anio', 'nota'], ['codigo', 'anio']],
  ['decisiones', 'rxd_decisiones', ['anio', 'codigo', 'texto', 'origen', 'responsable', 'fecha_limite', 'estado'], ['anio', 'codigo']],
  ['entradas', 'rxd_entradas', ['anio', 'nro', 'titulo', 'fuente', 'origen', 'nota'], ['anio', 'nro']],
];

async function importar(sql, data, reemplazar) {
  const out = {};
  for (const [k, table, cols, key] of IMPORT) {
    const rows = Array.isArray(data[k]) ? data[k] : [];
    if (!rows.length) { out[k] = 0; continue; }
    const upd = cols.filter(c => !key.includes(c));
    const conflict = reemplazar && upd.length
      ? `on conflict (${key.join(',')}) do update set ${upd.map(c => `${c}=excluded.${c}`).join(',')}`
      : `on conflict (${key.join(',')}) do nothing`;
    const r = await sql.query(
      `insert into ${table} (${cols.join(',')}) select ${cols.join(',')} from jsonb_populate_recordset(null::${table}, $1::jsonb) ${conflict} returning 1`,
      [JSON.stringify(rows)]);
    out[k] = r.length;
  }
  await log(sql, null, 'importacion', 'historicos', reemplazar ? 'reemplazar' : 'completar', null, JSON.stringify(out));
  return out;
}

// ---------- lectura en vivo de las otras apps del SGC (misma base) ----------
async function vivo(sql, anio) {
  const [foda, ries, opor, partes, nec, aud, hall, cap, om, apc] = await Promise.all([
    sql.query(`select cuadrante, count(*)::int n, coalesce(sum(importancia*intensidad*tendencia),0)::int puntaje,
      count(*) filter (where valorado)::int valorados, count(*) filter (where a_validar)::int a_validar from foda_items where anio=$1 group by cuadrante`, [anio]),
    sql.query(`select count(*)::int n, count(*) filter (where nivel_residual is not null and nivel_residual<>'')::int con_residual,
      count(*) filter (where a_validar)::int a_validar,
      count(*) filter (where nivel_inicial in ('Alto','Extremo'))::int altos from a29_riesgos where anio=$1`, [anio]),
    sql.query(`select count(*)::int n, count(*) filter (where a_validar)::int a_validar from a29_oportunidades where anio=$1`, [anio]),
    sql.query(`select count(*)::int n, count(*) filter (where pertinente ilike 's%')::int pertinentes, count(*) filter (where a_validar)::int a_validar from a32_partes where anio=$1`, [anio]),
    sql.query(`select count(*)::int n, count(*) filter (where aborda_sgc ilike 's%')::int aborda from a32_necesidades where anio=$1`, [anio]),
    sql.query(`select a.nro, a.proceso, a.auditor, a.estado, a.fecha_auditoria::text fecha,
      count(*) filter (where h.tipo='NC')::int nc, count(*) filter (where h.tipo='HA')::int ha, count(*) filter (where h.tipo='OM')::int om
      from aud_auditorias a left join aud_hallazgos h on h.auditoria_id=a.id where a.anio=$1 group by a.id order by a.nro`, [anio]),
    sql.query(`select h.tipo, coalesce(h.estado,'abierto') estado, count(*)::int n from aud_hallazgos h join aud_auditorias a on a.id=h.auditoria_id
      where a.anio=$1 group by 1,2 order by 1,2`, [anio - 1]),
    sql.query(`select count(*) filter (where programada)::int programadas, count(*) filter (where estado='Cumplida')::int cumplidas,
      count(*)::int total from rrhh_capacitaciones where anio=$1`, [anio]),
    sql.query(`select count(*)::int n, count(*) filter (where estado='Implementado')::int implementadas from om`),
    sql.query(`select indicador, max(periodo) ultimo, round(avg(valor),2)::float promedio, count(*)::int n from apc_valores where periodo like $1 group by indicador`, [anio + '-%']),
  ]);
  return { anio, foda, riesgos: ries[0], oportunidades: opor[0], partes: partes[0], necesidades: nec[0], auditorias: aud,
    hallazgos_anio_anterior: hall, capacitaciones: cap[0], om: om[0], apendice_c: apc };
}

async function handle(req, env, url) {
  const p = url.pathname.replace(/\/+$/, '');
  if (p === '/api/health') return json(req, env, { ok: true });

  await requireAdmin(req, env);
  const sql = neon(await secret(env.DATABASE_URL));
  const m = req.method;

  // --- todo lo liviano en una sola llamada (sin el texto de las minutas) ---
  if (m === 'GET' && p === '/api/resumen') {
    const q = (t, o) => sql.query(`select ${t.cols || '*'} from ${t.table} order by ${o || t.order}`);
    const [revisiones, secciones, indicadores, valores, auditorias, reclamos, acciones, seguimiento, decisiones, entradas] = await Promise.all([
      q(REG.revision), sql.query('select anio, nro, titulo, origen, length(texto)::int largo, actualizado_en from rxd_secciones order by anio, nro'),
      sql.query('select * from rxd_indicadores order by orden'), q(REG.valor), q(REG.auditoria), q(REG.reclamo), q(REG.accion),
      q(REG.seguimiento), q(REG.decision), q(REG.entrada)]);
    return json(req, env, { revisiones, secciones, indicadores, valores, auditorias, reclamos, acciones, seguimiento, decisiones, entradas });
  }

  // --- texto de la minuta de un año ---
  if (m === 'GET' && p === '/api/minuta') {
    const anio = Number(url.searchParams.get('anio'));
    if (!Number.isInteger(anio)) throw new HttpError(400, 'Falta el año.');
    return json(req, env, await sql.query('select anio, nro, titulo, texto, origen, actualizado_en from rxd_secciones where anio=$1 order by nro', [anio]));
  }

  // --- datos en vivo de las otras apps ---
  if (m === 'GET' && p === '/api/vivo') {
    const anio = Number(url.searchParams.get('anio'));
    if (!Number.isInteger(anio)) throw new HttpError(400, 'Falta el año.');
    return json(req, env, await vivo(sql, anio));
  }

  if (m === 'GET' && p === '/api/historial') {
    const lim = Math.min(Number(url.searchParams.get('limite')) || 200, 1000);
    return json(req, env, await sql.query('select * from rxd_historial order by id desc limit $1', [lim]));
  }

  // --- cargar los históricos desde data/historicos.json ---
  if (m === 'POST' && p === '/api/admin/importar') {
    const data = await readBody(req);
    const reemplazar = url.searchParams.get('reemplazar') === '1';
    try { return json(req, env, { ok: true, insertados: await importar(sql, data, reemplazar) }); } catch (e) { dbError(e); }
  }

  // --- nueva decisión: el código D<n> se asigna acá ---
  if (m === 'POST' && p === '/api/decision') {
    const b = await readBody(req);
    const anio = Number(b.anio);
    if (!Number.isInteger(anio)) throw new HttpError(400, 'Falta el año.');
    if (!b.texto || !String(b.texto).trim()) throw new HttpError(400, 'Falta el texto de la decisión.');
    const r = await sql.query(`select coalesce(max(substring(codigo from 2)::int),0)+1 sig from rxd_decisiones where anio=$1 and codigo ~ '^D[0-9]+$'`, [anio]);
    const codigo = 'D' + r[0].sig;
    const vals = {};
    for (const c of Object.keys(REG.decision.cols)) if (c in b) vals[c] = clean(REG.decision, c, b[c]);
    const cols = ['anio', 'codigo', ...Object.keys(vals)];
    try {
      const ins = await sql.query(`insert into rxd_decisiones (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`,
        [anio, codigo, ...Object.values(vals)]);
      await log(sql, anio, 'decision', codigo, 'alta', null, 'creada');
      return json(req, env, ins[0], 201);
    } catch (e) { dbError(e); }
  }

  // --- altas/cambios (PUT = crea o actualiza solo los campos enviados) y bajas: /api/<registro>/<clave...> ---
  const mm = p.match(/^\/api\/(revision|seccion|valor|auditoria|reclamo|accion|seguimiento|decision|entrada)(?:\/(.+))?$/);
  if (mm) {
    const nombre = mm[1], reg = REG[nombre];
    const parts = mm[2] ? mm[2].split('/') : [];

    if (m === 'GET' && !parts.length) return json(req, env, await sql.query(`select * from ${reg.table} order by ${reg.order}`));

    if ((m === 'PUT' || m === 'PATCH') && parts.length) {
      const b = await readBody(req);
      const kv = keyVals(reg, parts);
      const patch = {};
      for (const c of Object.keys(reg.cols)) if (c in b) patch[c] = clean(reg, c, b[c]);
      if (!Object.keys(patch).length) throw new HttpError(400, 'No hay campos para cambiar.');
      if (nombre === 'seccion' && !('origen' in patch)) patch.origen = 'editada';
      const where = reg.key.map((k, i) => `${k}=$${i + 1}`).join(' and ');
      const old = await sql.query(`select * from ${reg.table} where ${where}`, kv);
      const cols = Object.keys(patch);
      const allCols = [...reg.key, ...cols];
      const ph = allCols.map((_, i) => '$' + (i + 1)).join(',');
      const sets = cols.map(c => `${c}=excluded.${c}`);
      if (reg.stamp) sets.push('actualizado_en=now()');
      let r;
      try {
        r = await sql.query(`insert into ${reg.table} (${allCols.join(',')}) values (${ph})
          on conflict (${reg.key.join(',')}) do update set ${sets.join(',')} returning *`, [...kv, ...cols.map(c => patch[c])]);
      } catch (e) { dbError(e); }
      const anio = reg.key.includes('anio') ? kv[reg.key.indexOf('anio')] : (r[0].origen_anio ?? null);
      const clave = kv.join('/');
      if (!old.length) await log(sql, anio, nombre, clave, 'alta', null, 'creado');
      else for (const c of cols) {
        const a = old[0][c], d = r[0][c];
        if (String(a ?? '') !== String(d ?? '')) await log(sql, anio, nombre, clave, c, nombre === 'seccion' && c === 'texto' ? `(${String(a ?? '').length} caracteres)` : a, nombre === 'seccion' && c === 'texto' ? `(${String(d ?? '').length} caracteres)` : d);
      }
      return json(req, env, r[0], old.length ? 200 : 201);
    }

    if (m === 'DELETE' && parts.length) {
      const kv = keyVals(reg, parts);
      const where = reg.key.map((k, i) => `${k}=$${i + 1}`).join(' and ');
      const r = await sql.query(`delete from ${reg.table} where ${where} returning *`, kv);
      if (!r.length) throw new HttpError(404, 'Registro inexistente.');
      await log(sql, reg.key.includes('anio') ? kv[reg.key.indexOf('anio')] : null, nombre, kv.join('/'), 'baja', JSON.stringify(r[0]).slice(0, 2000), null);
      return json(req, env, { ok: true });
    }
  }

  throw new HttpError(404, 'Ruta inexistente.');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    try {
      return await handle(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json(req, env, { error: e.message }, e.status);
      console.error('RxD error:', e && e.stack || e);
      return json(req, env, { error: 'Error interno. Reintentá en unos segundos.' }, 500);
    }
  },
};

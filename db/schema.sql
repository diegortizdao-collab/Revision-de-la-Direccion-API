-- Revisión por la dirección · Silver Industrial (ISO 9001, 9.3 · registros A.19 y A.24)
-- Se aplica en Neon (proyecto Silver No Conformidades). Idempotente. Todas las tablas llevan el prefijo rxd_.
create table if not exists rxd_revisiones (
  anio int primary key, fecha date, titulo text not null, estado text not null default 'borrador'
    check (estado in ('borrador','cerrada')),
  archivo_url text, actualizado_en timestamptz not null default now());
create table if not exists rxd_secciones (
  anio int not null, nro int not null check (nro between 1 and 18), titulo text not null, texto text not null default '',
  origen text not null default 'borrador' check (origen in ('historico','borrador','editada')),
  actualizado_en timestamptz not null default now(), primary key (anio, nro));
create table if not exists rxd_indicadores (
  clave text primary key, nombre text not null, unidad text not null default '%', direccion text not null check (direccion in ('<','>')),
  grupo text not null default 'apendice_c' check (grupo in ('apendice_c','dato')), orden int not null default 0, nota text);
create table if not exists rxd_valores (
  clave text not null references rxd_indicadores(clave) on delete cascade, anio int not null,
  valor numeric, meta numeric, parcial boolean not null default false, nota text,
  actualizado_en timestamptz not null default now(), primary key (clave, anio));
create table if not exists rxd_auditorias (
  anio int not null, nro int not null, tema text not null, auditor text, fecha text,
  nc int, ha int, om int, primary key (anio, nro));
create table if not exists rxd_reclamos (
  anio int not null, cliente text not null, cantidad int not null default 0, primary key (anio, cliente));
create table if not exists rxd_acciones (
  codigo text primary key, origen_anio int not null, texto text not null,
  estado text not null default 'abierta' check (estado in ('abierta','en curso','cumplida','descartada')),
  responsable text, fecha_limite date, cerrada_anio int, actualizado_en timestamptz not null default now());
create table if not exists rxd_seguimiento (
  codigo text not null references rxd_acciones(codigo) on delete cascade, anio int not null, nota text not null default '',
  primary key (codigo, anio));
create table if not exists rxd_decisiones (
  anio int not null, codigo text not null, texto text not null, origen text, responsable text, fecha_limite date,
  estado text not null default 'propuesta' check (estado in ('propuesta','aprobada','en curso','cumplida','descartada')),
  actualizado_en timestamptz not null default now(), primary key (anio, codigo));
create table if not exists rxd_entradas (
  anio int not null, nro int not null check (nro between 1 and 17), titulo text not null, fuente text,
  origen text not null default 'manual' check (origen in ('auto','mixto','manual','sin')), nota text,
  actualizado_en timestamptz not null default now(), primary key (anio, nro));
create table if not exists rxd_historial (
  id bigserial primary key, anio int, registro text not null, clave text not null, campo text not null,
  antes text, despues text, en timestamptz not null default now());
create index if not exists rxd_historial_idx on rxd_historial (registro, clave);

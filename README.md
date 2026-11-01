# Revision-de-la-Direccion-API

API (Cloudflare Worker + Neon) de la **Revisión por la dirección** de Silver Industrial (ISO 9001, 9.3 · registros A.19 y A.24).
El frontend está en `Revision-de-la-Direccion` (GitHub Pages).

Guarda las revisiones desde 2023, la minuta A.24 por secciones, los valores de los indicadores por año, las acciones heredadas con su seguimiento y las decisiones. Además **lee en vivo** lo que cargan las otras apps del SGC, que comparten la misma base de Neon: Contexto (FODA, A.29, A.32), Auditorías Internas, Recursos Humanos y Apéndice C (`GET /api/vivo?anio=`).

## Puesta en marcha
1. **Neon**: aplicar `db/schema.sql` en el proyecto *Silver No Conformidades* (ya aplicado desde esta sesión; es idempotente).
2. **Worker**: `npm install` y `npx wrangler deploy`. Usa los mismos secretos que FODA-Silver-API (`ADMIN_KEY` y `DATABASE_URL` del Secrets Store, declarados en `wrangler.toml`; si no figuran ahí, el deploy los borra). Probar `https://revision-de-la-direccion-api.<cuenta>.workers.dev/api/health`.
3. **Históricos**: entrar a la app, y con la base vacía aparece el botón *Cargar históricos* (envía `data/historicos.json` a `POST /api/admin/importar`). Es idempotente: no pisa lo editado. Con `?reemplazar=1` sobrescribe.

## Rutas (todas con el encabezado `X-Clave`, salvo `/api/health`)
| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/resumen` | Todo lo liviano en una llamada (sin el texto de las minutas) |
| GET | `/api/minuta?anio=` | Secciones 1 a 18 de la minuta del año |
| GET | `/api/vivo?anio=` | Datos en vivo de Contexto, Auditorías, RR.HH. y Apéndice C |
| GET | `/api/historial` | Cambios hechos en el módulo |
| PUT/DELETE | `/api/<registro>/<clave…>` | Alta o cambio (solo los campos enviados) y baja. Registros: `revision/<año>`, `seccion/<año>/<nro>`, `valor/<clave>/<año>`, `auditoria/<año>/<nro>`, `reclamo/<año>/<cliente>`, `accion/<código>`, `seguimiento/<código>/<año>`, `decision/<año>/<código>`, `entrada/<año>/<nro>` |
| POST | `/api/decision` | Nueva decisión (el código `D<n>` lo asigna el servidor) |
| POST | `/api/admin/importar` | Carga de los históricos |

Toda modificación queda en `rxd_historial`. Las tablas llevan el prefijo `rxd_`.

Desarrollado por Mgter. Diego Ortiz — Líder de Mejora Continua | Consultor ISO

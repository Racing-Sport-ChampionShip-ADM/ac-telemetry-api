# AC Telemetry API

Backend REST para la plataforma de telemetría de Assetto Corsa. Recibe datos de:
- La app Python in-game (sesiones, vueltas, setups)
- RaceControl (resultados de carreras oficiales de liga)

Y expone datos para el frontend (perfil de piloto, records, etc.)

## Stack
- Node.js + Express
- PostgreSQL (Supabase) vía `pg`

## Setup local

```bash
npm install
cp .env.example .env
# completar DATABASE_URL y RACE_CONTROL_TOKEN en .env
npm run dev
```

## Deploy en Render (gratis)

1. Subí este proyecto a un repo de GitHub.
2. En [render.com](https://render.com), **New > Web Service**.
3. Conectá el repo.
4. Configuración:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. En **Environment**, agregá las variables:
   - `DATABASE_URL`: la connection string de Supabase (Project Settings > Database > Connection string > URI). Preferir la de **connection pooling** (puerto 6543) — más apta para un backend que puede reiniciarse/dormir.
   - `RACE_CONTROL_TOKEN`: un token random tuyo (ej. generado con `openssl rand -hex 32`).
6. Deploy. Render te da una URL tipo `https://ac-telemetry-api.onrender.com`.

### Setups por sesión (requerido antes del deploy)

Esta versión agrega snapshots privados de los `.ini` guardados durante una
sesión. Antes de desplegar, ejecutá una vez
`db/migrations/20260819_session_setup_versions.sql` en el **SQL Editor** de
Supabase. El script crea el bucket privado `session-setups` y la tabla de
versiones. También agregá estas variables de entorno en Render:

- `SUPABASE_URL`: URL del proyecto Supabase.
- `SUPABASE_SERVICE_KEY`: service role key del proyecto. Nunca exponerla en
  el frontend ni en la Companion.

Los setups no son públicos: el backend descarga el archivo desde Storage y
valida que pertenezca al piloto autenticado antes de devolverlo.

Nota: en el free tier, el servicio se "duerme" tras un rato sin tráfico y el primer request después tarda ~30-50s en responder. Ya charlamos esto y es aceptable para este proyecto.

## Autenticación

- **App in-game / piloto**: header `Authorization: Bearer <api_key>` (el `api_key` se genera al registrar el piloto en `POST /api/pilotos`).
- **RaceControl**: header `Authorization: Bearer <RACE_CONTROL_TOKEN>` (el valor que pusiste en la env var).

## Endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/pilotos` | - | Registrar piloto, devuelve `api_key` |
| GET | `/api/pilotos/me` | piloto | Perfil del piloto autenticado |
| GET | `/api/pilotos/:id/perfil` | - | Perfil público de un piloto |
| POST | `/api/sesiones` | piloto | Abrir sesión (auto-crea auto/circuito) |
| PUT | `/api/sesiones/:id/cerrar` | piloto | Cerrar sesión |
| POST | `/api/vueltas` | piloto | Registrar una vuelta |
| POST | `/api/vueltas/batch` | piloto | Registrar varias vueltas (reintentos offline) |
| POST | `/api/setups` | piloto | Subir setup |
| GET | `/api/setups` | piloto | Listar setups propios |
| POST | `/api/race-control/resultados` | race-control | Reportar resultado de carrera oficial |

## Ejemplo de flujo completo (curl)

```bash
# 1. Registrar piloto
curl -X POST https://tu-api.onrender.com/api/pilotos \
  -H "Content-Type: application/json" \
  -d '{"nombre_piloto":"Juan Pérez","numero_piloto":27,"steam_id":"7656119..."}'
# => guarda el api_key de la respuesta

# 2. Abrir sesión
curl -X POST https://tu-api.onrender.com/api/sesiones \
  -H "Authorization: Bearer TU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "auto": {"nombre_interno":"ks_ferrari_488_gt3","nombre_visible":"Ferrari 488 GT3","categoria":"GT3"},
    "circuito": {"nombre_interno":"ks_monza","layout":"gp","nombre_visible":"Monza GP","longitud_metros":5793}
  }'
# => guarda el sesion_id

# 3. Registrar una vuelta
curl -X POST https://tu-api.onrender.com/api/vueltas \
  -H "Authorization: Bearer TU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sesion_id":"UUID_DE_SESION","numero_vuelta":1,"tiempo_ms":98500,"valida":true}'

# 4. Ver perfil
curl https://tu-api.onrender.com/api/pilotos/me \
  -H "Authorization: Bearer TU_API_KEY"
```

## Próximos pasos
- App Python in-game que llame estos endpoints automáticamente.
- Frontend web (registro + dashboard).

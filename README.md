# WaterMind

Aplicación web para llevar un registro personal de hidratación. Incluye acceso y creación de cuenta con Supabase Auth, registros por usuario protegidos con Row Level Security, resumen diario, historial, estadísticas y exportación CSV.

## Requisitos

- Node.js 20.19+ o 22.12+
- Un proyecto Supabase

## Desarrollo local

```sh
npm install
cp .env.example .env.local
npm run dev
```

Completa `.env.local` con la URL de Supabase y la clave pública/publishable (`anon`):

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
```

No pongas una clave `service_role` en variables `VITE_*` ni en el navegador.

## Base de datos y autenticación

Aplica `supabase/migrations/202610200001_initial_schema.sql` al proyecto Supabase. La migración crea exclusivamente las tablas `user_watermind`, `drink_entries_watermind` y `reminder_settings_watermind`, con políticas RLS vinculadas a `auth.uid()`. Las tablas no usan nombres genéricos compartidos, para no colisionar con las tablas preexistentes del proyecto.

La función `watermind_handle_new_user` crea el perfil al registrarse. Configura en Supabase Auth las URLs de sitio y redirección para los dominios local y de producción. Para habilitar eliminación de cuenta, despliega la función Edge `delete-account` con `SUPABASE_SERVICE_ROLE_KEY` configurada como secreto del servidor.

## Despliegue web

Importa el repositorio en Vercel, define `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en los entornos que publicarás y despliega. `vercel.json` conserva el enrutamiento de la SPA. WaterMind no necesita un servidor Render: la autenticación y persistencia usan Supabase; la función de eliminación corre como Supabase Edge Function.

## Verificación

```sh
npm run lint
npm test
npm run build
```

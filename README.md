# Columbia Shine · App de operación

Aplicación para operar el motolavado: recepción de motos, órdenes, vista del lavador, cobro, caja y turnos, clientes, agenda y reportes.

Es un monorepo con un solo despliegue: Node sirve la API y también la app de Angular ya compilada.

```
apps/api   Backend Node + Express + TypeScript (API en /api)
apps/web   Frontend Angular
db/migrations   SQL de la base de datos (PostgreSQL / Supabase)
```

## Roles

| Rol | Cómo entra | Qué hace |
| --- | --- | --- |
| Propietario | Usuario y contraseña | Todo: precios, usuarios, reportes con rentabilidad, anular cobros |
| Administrador de turno | Usuario y contraseña | Recibe, asigna, cobra, abre y cierra caja, agenda. Para anular un cobro pide aprobación |
| Lavador | Usuario y contraseña | Ve solo sus motos; marca inicio y fin del servicio |
| Cliente | Usuario o correo y clave | Agenda su lavado en `/cliente` |

Pago a lavadores: 45 % de cada servicio que lava la persona (valor configurable en la tabla `settings`, clave `commission_pct`). Las propinas se reparten por igual entre quienes lavaron en el turno.

## Despliegue en Railway con Supabase

1. **Supabase**: crea un proyecto. En *Project Settings → Database → Connection string* copia la cadena del **Session pooler** (Railway no tiene salida IPv6, así que la conexión directa no sirve).
2. **Railway**: *New Project → Deploy from GitHub repo* y elige este repositorio. `railway.json` ya define la compilación (`npm run build`) y el arranque (`npm start`).
3. En Railway, pestaña *Variables*, define:

   | Variable | Valor |
   | --- | --- |
   | `DATABASE_URL` | La cadena del Session pooler de Supabase |
   | `JWT_SECRET` | Un texto largo y aleatorio |
   | `OWNER_USERNAME` | Usuario del propietario para entrar (ej. `propietario`) |
   | `OWNER_EMAIL` | Opcional: correo del propietario |
   | `OWNER_PASSWORD` | Contraseña del propietario (mínimo 8 caracteres) |
   | `OWNER_NAME` | Nombre del propietario |
   | `NODE_ENV` | `production` |

4. Al arrancar, la app aplica sola las migraciones de `db/migrations` y crea el usuario propietario si no existe.
5. Entra con el usuario del propietario, ve a **Ajustes** y crea al administrador y a los lavadores con su usuario y contraseña.

Las tablas quedan con RLS activo y sin políticas: solo el backend puede leerlas, no la API pública de Supabase.

## Desarrollo local

Necesitas Node 22.12 o superior y Docker Desktop.

```bash
npm install
cp .env.example .env          # y pon DATABASE_URL=postgresql://postgres:postgres@localhost:5433/columbia_shine
npm run db:up                 # PostgreSQL local en Docker, puerto 5433
npm run build
npm run start:local           # app completa en http://localhost:3000
```

La primera vez que arranca aplica las migraciones y crea el propietario con los datos del `.env`.

Para trabajar con recarga automática, en dos terminales: `npm run dev:api` (API en el puerto 3000) y `npm run dev:web` (Angular en http://localhost:4200, con proxy hacia la API).

Para borrar la base local y empezar de cero: `docker compose down -v` y luego `npm run db:up`.

## Pendiente para las siguientes fases

Facturación electrónica (Factus), membresías, inventario y consumo de producto, mantenimiento de equipos, avisos por WhatsApp.

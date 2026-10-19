# Columbia Shine · contexto para Claude

App de operación de **Columbia Shine**, un motolavado (lavado y detailing de motos) en Medellín, Colombia.
Dueño: Juan Camilo Arenas. Administrador de turno: Gregorio (también lava).
Todo el texto de la interfaz va en **español de Colombia**, claro y corto, pensado para usarse en tablet y celular durante la jornada.

## Stack y estructura

Monorepo con npm workspaces y **un solo despliegue en Railway**: Node sirve la API en `/api` y también el Angular ya compilado.

```
apps/api/            Node 22 + Express 5 + TypeScript (CommonJS), SQL directo con pg (sin ORM)
  src/main.ts        Arranque: migraciones, crea el propietario, sirve /api y el Angular compilado
  src/db.ts          Pool, q(), one(), tx(), audit(), setting(), migrate(), TODAY, localDate()
  src/auth.ts        JWT, middleware auth(...roles), HttpError, need(), validadores int/text/optText
  src/routes-cuentas.ts    Ingreso (usuario o correo y contraseña), usuarios, servicios y precios, auditoría
  src/routes-ordenes.ts    Clientes, motos, órdenes, adicionales, cobros y anulaciones
  src/routes-operacion.ts  Caja y turnos, inicio (dashboard), agenda, reportes
apps/web/            Angular 21, componentes standalone, sin zone.js (todo el estado en signals)
  src/app/core.ts    Api (fetch), Session, Toast, guard only(), pipes money y cuando, utilidades de fecha
  src/app/app.ts     Barra superior y menú según rol
  src/app/app.routes.ts    Rutas con carga diferida y guardas por rol
  src/app/pages/*.ts Una página por archivo (plantilla y estilos dentro del mismo archivo)
  src/styles.css     Colores de marca y clases globales (.card, .btn, .opcion, .pastilla, .kpi, .campo…)
db/migrations/       SQL numerado (001_inicial.sql … 004_descuento.sql). Se aplica solo al arrancar la API
railway.json         build: npm run build · start: npm start · healthcheck: /api/health
docker-compose.yml   PostgreSQL 17 local en el puerto 5433 (base columbia_shine, usuario y clave postgres)
```

## Comandos

```bash
npm install                 # instala todo el monorepo (Node 22.12 o superior)
npm run db:up               # PostgreSQL local en Docker (puerto 5433)
npm run build               # compila apps/web y luego apps/api
npm run start:local         # app completa en http://localhost:3000 con el .env
npm run dev:api             # API con recarga (tsx watch, lee el .env)
npm run dev:web             # Angular con recarga en :4200, proxy de /api al puerto 3000
npm run db:down             # apaga la base local (docker compose down -v la borra)
```

En CI o sin terminal interactiva, compilar Angular con `CI=1` para que no pregunte nada.

**Bug de Angular (21.2):** si dos componentes tienen estilos idénticos (`styles`), `ng build` compila pero el proceso nunca termina (esbuild queda abierto), y el despliegue en Railway se quedaría colgado. Estilos compartidos entre componentes van en `styles.css`, no repetidos ni en una constante.

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | PostgreSQL. Local: `postgresql://postgres:postgres@localhost:5433/columbia_shine` (sin SSL). En producción: Supabase, cadena del **Session pooler** (Railway no tiene IPv6) |
| `JWT_SECRET` | Obligatoria en producción |
| `OWNER_USERNAME`, `OWNER_PASSWORD`, `OWNER_NAME` | Crean el propietario la primera vez que arranca. `OWNER_EMAIL` es opcional |
| `PORT` | Railway la define sola |
| `NODE_ENV` | `production` en Railway |

## Roles y permisos

| Rol | Ingreso | Puede |
| --- | --- | --- |
| `OWNER` propietario | Usuario y contraseña en `/ingreso` | Todo. Precios, usuarios, rentabilidad, anular cobros directamente |
| `ADMIN` administrador de turno | Usuario y contraseña en `/ingreso` | Recibir, asignar, cobrar, caja, agenda, reporte del día. **No** borra ni anula cobros: pide aprobación |
| `WASHER` lavador | Usuario y contraseña en `/ingreso` | Solo sus motos: iniciar y terminar (queda lista para entregar). Nunca ve cifras del negocio |
| `CLIENT` cliente | Usuario o correo y clave en `/cliente` | Agendar y cancelar sus reservas, registrar sus motos |

- `/auth/login` recibe `{ login, password, staff }`: `login` es el usuario o el correo (sin importar mayúsculas). Con `staff: true` solo entra el equipo; sin él, solo clientes.
- El usuario (`users.username`) es único en minúsculas: 3 a 30 caracteres `a-z 0-9 . _ -`. Lo valida `username()` de `auth.ts`.
- Contraseña mínima: 8 caracteres para el equipo, 6 para clientes. El propietario crea al equipo y le cambia usuario o contraseña en Ajustes.
- El registro de clientes pide nombre, usuario, celular (para contactarlo) y correo opcional.
- El PIN ya no se usa (la columna `pin_hash` quedó sin uso).
- Bloqueo de 15 minutos tras 5 intentos fallidos.

## Flujo de una orden

`WAITING` (En espera) → `WASHING` (En lavado) → `READY` (Lista para entregar) → `DELIVERED` (Entregada). También `CANCELLED`.

- **Cobrar y entregar son pasos separados.** Se puede cobrar en cualquier estado abierto y la orden sigue su flujo. Si se cobra estando `READY`, se entrega de una vez; si ya estaba pagada, al quedar `READY` sale el botón "Entregar" (`READY → DELIVERED` en `/orders/:id/status`, solo OWNER y ADMIN y solo con cobro activo).

- Sin checklist ni revisión de entrega: se asigna lavador, se lava y al terminar queda lista para entregar.
- El lavador solo hace WAITING→WASHING y WASHING→READY, y solo en sus órdenes.
- `REVIEW` sigue en el CHECK de la tabla `orders` por compatibilidad, pero ya no se usa (la API lo rechaza como destino).
- Para iniciar el lavado debe haber lavador asignado. Solo lavan los usuarios ADMIN y WASHER: al propietario nunca se le asigna una moto (lo valida la API).
- Número de orden: `CS-000001` (secuencia `order_number_seq`).

## Cliente de afán

- En recepción, una moto nueva se puede recibir "solo con la placa" (`rush: true` en `POST /orders`): se crea un cliente propio "Sin registrar" con `customers.pending = true`. Uno por moto, no uno compartido, para que el historial siga a la placa.
- Cuando vuelve, al escribir la placa la recepción avisa y deja completar nombre y celular; también se completa en la ficha del cliente (abre el formulario solo).
- `completeCustomer()` en `routes-ordenes.ts`: si el celular ya es de otro cliente y el actual es de afán, los une (motos, órdenes y reservas pasan al existente y el de afán se borra). Con un cliente normal, un celular repetido sigue siendo error.
- Queda en `audit_log` como `CLIENTE_COMPLETADO` o `CLIENTE_UNIDO`.

## Varias motos por cliente

- Un cliente puede tener varias motos (`bikes.customer_id`). El cliente las agrega al agendar; en el local, con una placa nueva se elige "Ya es cliente: otra moto", se busca por nombre, celular o placa y se envía `customerId` en `POST /orders`.
- Los clientes de afán no aparecen en esa búsqueda.

## Facturar

- `/facturar` (menú "Facturar"): "Por cobrar" con todas las órdenes abiertas sin cobro y su estado, buscador por placa, cliente u orden, y botón Cobrar. Abajo, "Cobrado en este turno" con el comprobante de cada cobro.
- Avisa si no hay turno de caja abierto.

## Comprobante de venta

- `/comprobante/:paymentId` (OWNER y ADMIN): comprobante imprimible de un cobro, con logo, placa, servicios, propina, medio de pago, recibido y cambio. Botones para imprimir y enviar por WhatsApp. Si el cobro fue anulado sale la marca "ANULADO".
- Se abre solo al terminar un cobro; también desde la orden ("Ver comprobante") y desde Caja.
- **No es factura electrónica** y así lo dice el pie. La factura DIAN con Factus sigue pendiente.
- Al imprimir, `@media print` de `styles.css` oculta la barra superior y todo lo que tenga la clase `.no-imprimir`.

## Reglas del negocio que no se deben romper

- **Un cobro nunca se borra.** ADMIN pide la anulación (`void_status = REQUESTED`); OWNER aprueba o rechaza. Al aprobar, el cobro queda `APPROVED` (anulado) y la orden vuelve a `READY`.
- Se cobra una orden abierta en **cualquier estado** (WAITING, WASHING o READY), desde la vista **Facturar** (`/facturar`), y solo con un **turno de caja abierto**. Un solo turno abierto a la vez. No se entrega sin cobro.
- **Descuento** al cobrar, en pesos o porcentaje (la pantalla lo convierte a pesos), con motivo obligatorio. `payments.amount` queda con el valor ya descontado y `payments.discount` / `discount_reason` guardan el descuento: ventas, caja y comisión usan lo que de verdad se cobró. Sale en el comprobante y en `audit_log`.
- Una orden con cobro activo no se puede cancelar ni modificar.
- **Comisión: 45%** de lo cobrado en cada orden que lavó la persona (incluye adicionales, descontado el descuento si lo hubo). Valor en `settings.commission_pct`. Sin base fija en el sistema: la base temporal de Gregorio la maneja el dueño por fuera.
- Propinas: se reparten por igual entre quienes lavaron en el turno.
- Efectivo esperado = base + ventas y propinas en efectivo + entradas − gastos − retiros. Al cerrar, si hay diferencia, la explicación es obligatoria.
- Adicionales "desde" (óxido, desmanchado): se pueden cobrar por encima del precio base, nunca por debajo.
- El costo directo de los servicios (`services.direct_cost`) solo lo ve el OWNER.
- Toda acción sensible queda en `audit_log` con `audit()`.
- Dinero en **pesos enteros** (int). Fechas en **hora de Bogotá**: usar `TODAY` y `localDate()` de `db.ts` en el backend y el pipe `cuando` en el frontend.
- Fotos de recepción: se reducen en el navegador a JPEG de máximo 1280 px y se guardan en `order_photos` (bytea), máximo 6 por orden.

## Servicios (del manual interno)

Precios vigentes en producción (octubre 2026). Las migraciones siembran los precios originales; en producción se cambian desde Ajustes.

| Servicio | Precio | Tiempo objetivo | Costo directo |
| --- | --- | --- | --- |
| Shine Basic | $16.000 | 20–25 min | $5.600 |
| Shine Premium | $26.000 | 30–40 min | $8.900 |
| Shine Detail (recomendado) | $40.000 | 60–75 min | $17.100 |
| Shine Full | $60.000 | 120–150 min | $30.200 |

Adicionales: detallado de motor $15.000, cadena $12.000, cera porcelanizadora $10.000, llantas $7.000, plásticos $8.000, óxido desde $10.000, desmanchado desde $10.000.

## Agenda

- Lunes a viernes 10:00 a. m. a 7:30 p. m. (cupos de 10:00 a 6:00 p. m.); sábado y domingo 9:00 a. m. a 5:30 p. m. (cupos de 9:00 a 4:00 p. m.).
- 2 cupos por hora (`settings.slot_capacity`), hasta 30 días adelante, máximo 3 reservas activas por cliente y **máximo 2 para un mismo día** (`MAX_PER_DAY` en `routes-operacion.ts`), para que nadie acapare cupos.
- Antes de crear la reserva se confirma en un modal con el resumen (cliente y administrador).
- Agendan el cliente registrado (`/cliente`) y el administrador o propietario (`/agenda`). "Llegó: recibir" abre la recepción con los datos de la reserva.

## Base de datos

- Tablas: `users`, `customers`, `bikes`, `services`, `orders`, `order_items`, `order_photos`, `payments`, `shifts`, `cash_movements`, `bookings`, `audit_log`, `settings`, `schema_migrations`.
- Todas con RLS activo y sin políticas: solo el backend (dueño de las tablas) lee y escribe; la API pública de Supabase no ve nada.
- **Nunca editar una migración ya aplicada.** Para cambiar el esquema, crear `db/migrations/002_descripcion.sql`, y activar RLS en cada tabla nueva.

## Convenciones de código

- Backend: validar con `need()`, `int()`, `text()`; errores al usuario con `HttpError` y mensajes en español; operaciones de varias escrituras dentro de `tx()`.
- Frontend: signals para todo el estado (no hay zone.js); `[(ngModel)]` enlazado a signals; llamadas con `Api` y errores con `toast.fail`.
- Campos de dinero: `<input class="campo" dinero [(ngModel)]="valor" />` (directiva `MoneyInput` de `core.ts`): muestra separador de miles y el modelo recibe un número o null. No usar `type="number"` para pesos.
- Modales: `.modal-fondo` + `.modal.card` de `styles.css`, con `role="dialog"` y `aria-modal`.
- Controles de mínimo 44 px de alto, acción principal en amarillo, etiquetas `<label>` reales, nada de emojis.

## Diseño de marca

Fondo oscuro `#0B0F17`, paneles `#111827` y `#1E293B`, amarillo `#FFD200` (acción principal, texto negro encima), azul oscuro `#0047A3` (seleccionado, texto blanco encima), azul `#007BFF`, aqua `#0EA5E9`. Tipografía Montserrat; títulos en ExtraBold Itálica como el logo. Logo en `apps/web/public/logo.png`. Lema: "Pasión por tu máquina."

## Pendiente (siguientes fases)

1. Verificar el celular del cliente con código por WhatsApp antes de abrir la agenda al público (hoy el registro no lo verifica).
2. Aviso "tu moto está lista" por WhatsApp.
3. Consumo real de producto por servicio para reemplazar los costos estimados.
4. Facturación electrónica con Factus (venta → pago → factura → entrega, guardar CUFE).
5. Membresías (Básica, Plus, Premium), inventario con stock mínimo, mantenimiento de equipos.
6. Pasar las fotos a Supabase Storage si el volumen crece.

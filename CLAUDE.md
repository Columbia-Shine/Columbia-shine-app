# Columbia Shine · contexto para Claude

App de operación de **Columbia Shine**, un motolavado (lavado y detailing de motos) en Bogotá, Colombia.
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
  src/routes-nomina.ts     Nómina diaria y acuerdos de mínimo (solo OWNER)
  src/routes-finanzas.ts   Gastos por fuera de la caja y cierre del mes (solo OWNER)
  src/routes-inventario.ts Insumos: compras, conteos, alertas de stock bajo y consumo del mes
  src/routes-membresias.ts Planes y venta de membresías; src/membership.ts activeMembership()
apps/web/            Angular 21, componentes standalone, sin zone.js (todo el estado en signals)
  src/app/core.ts    Api (fetch), Session, Toast, guard only(), pipes money y cuando, utilidades de fecha
  src/app/app.ts     Barra superior y menú según rol
  src/app/app.routes.ts    Rutas con carga diferida y guardas por rol
  src/app/pages/*.ts Una página por archivo (plantilla y estilos dentro del mismo archivo)
  src/styles.css     Colores de marca y clases globales (.card, .btn, .opcion, .pastilla, .kpi, .campo…)
db/migrations/       SQL numerado (001_inicial.sql … 015_membresias.sql). Se aplica solo al arrancar la API
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

- Hay un solo propietario y varios lavadores. **Quién lava** (se le asignan motos, tiene comisión, nómina y "Mi mes"): todos los WASHER y los ADMIN con `users.washes = true` (helper `WASHES()` de `auth.ts`). Gregorio es el único administrador que lava; el usuario "Columbia" (celular de la empresa) solo administra. Se cambia en Ajustes con "También lava" / "Ya no lava".
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

## Motos sin placa

- En Recepción, "Moto sin placa": se le asigna un código interno `SP0001`, `SP0002`… (secuencia `no_plate_seq`, `bikes.no_plate = true`) y se pide la marca y cómo reconocerla (queda en `bikes.notes`). Con ese código se busca la próxima vez o se recibe desde la ficha del cliente.

## Varias motos por cliente

- Un cliente puede tener varias motos (`bikes.customer_id`). El cliente las agrega al agendar; en el local, con una placa nueva se elige "Ya es cliente: otra moto", se busca por nombre, celular o placa y se envía `customerId` en `POST /orders`.
- Los clientes de afán no aparecen en esa búsqueda.
- Si el cliente trae varias motos a la vez: "Crear y recibir otra moto de este cliente" crea la orden y deja la recepción lista para la siguiente placa con el cliente ya elegido (modo "Ya es cliente"), conservando el servicio.

## Avisos y pantalla

- **Moto lista**: en la orden (y en el tablero) un botón abre WhatsApp con el mensaje "tu moto está lista" (`readyWhatsapp()` de `core.ts`); se marca `orders.notified_at`. No usa ningún servicio pagado: es un enlace `wa.me`.
- **Pantalla del local** (`/pantalla`): motos en espera, en lavado y listas, en letra grande, sin menú, se actualiza cada 15 s. Se abre desde Órdenes.
- **Clientes para recuperar** (Clientes → "Para recuperar"): quienes no vuelven hace 30/45/60/90 días, con celular, sin reserva ni moto en el local. Mensaje editable con {nombre} y {placa}; al escribirles queda `customers.last_contacted_at`.

## Facturar

- `/facturar` (menú "Facturar"): "Por cobrar" con todas las órdenes abiertas sin cobro y su estado, buscador por placa, cliente u orden, y botón Cobrar. Abajo, "Cobrado en este turno" con el comprobante de cada cobro.
- Avisa si no hay turno de caja abierto.

## Nómina y acuerdos de mínimo

- `/nomina` (solo OWNER, menú "Nómina"): por día y por persona, lavados, lo cobrado de las motos que lavó, comisión, propinas, ajuste del acuerdo y total. "Registrar pago" guarda la foto de esas cifras en `payroll_days` (uno por persona y día; se puede deshacer).
- Acuerdo de mínimo (`pay_guarantees`, por persona y fechas): sin lavados en el día se paga `base_no_wash` solo si se marca que vino; con lavados, si la comisión no llega a `min_commission` se completa hasta ahí, pero nunca más de `max_topup` (vacío = sin tope) (`topupFor()`). Las propinas van aparte y no cuentan para el mínimo.
- Acuerdo vigente: Gregorio, primer mes del 19 oct al 18 nov de 2026: base $30.000 sin lavados, mínimo $75.000 de comisión y máximo $30.000 de ajuste (con $40.000 de comisión se completan $30.000, no $35.000).
- Al registrar el pago se elige cuánto sale en **efectivo de la caja** (se crea solo un RETIRO con categoría "Nómina" en el turno abierto, `payroll_days.cash_movement_id`) y por qué medio va el resto (`paid_other`, `other_method`). Deshacer borra el retiro si su turno sigue abierto. En el cierre, lo pagado por Nequi u otro medio se muestra aparte (`payrollOut`): ahí solo se confirma lo que entró de clientes.
- La sección "Acuerdos de mínimo" lleva el control: días pagados, comisiones, ajustes que puso el dueño y total pagado.
- **Mi mes** (`GET /my-month`, ADMIN y WASHER): en Reportes del administrador (menú "Mi mes y hoy") ve sus motos lavadas del mes, lo que generó, su comisión, lo que el dueño le ha pagado (con propinas y ajustes) día por día y su acuerdo. Solo sus números; el reporte del negocio para él sigue siendo del día.

## Gastos y cierre del mes

- Categorías de gasto en `EXPENSE_CATEGORIES` (API y `core.ts`): los GASTO de caja exigen categoría (`cash_movements.category`).
- Gastos pagados por fuera de la caja (arriendo por transferencia, etc.): tabla `expenses`, se registran en `/mes`.
- `/mes` (solo OWNER, menú "Mes"): ventas, motos, ticket, gastos por categoría (caja + por fuera), nómina (comisión de lo cobrado + ajustes; las propinas no son costo del negocio) y "te queda" = ventas − gastos − nómina, comparado con el mes anterior.

## Inventario

- `/inventario` (OWNER y ADMIN): insumos (`supplies`) con stock, mínimo y costo por unidad (el costo solo lo ve el OWNER; solo el OWNER crea insumos y cambia mínimos).
- Compra (`supply_moves` COMPRA): suma stock, actualiza el costo por unidad y registra el gasto de Insumos: en la caja del turno si se pagó con efectivo de la caja, o en `expenses` si se pagó por fuera.
- Conteo (`supply_moves` CONTEO): ajusta al stock real; la diferencia negativa es lo gastado. El consumo del mes sale de los conteos, valorizado, y da el costo real por moto.
- Alerta en Inicio cuando un insumo está en su mínimo o por debajo (`lowStock` del dashboard).

## Membresías

- Planes en Ajustes (`membership_plans`): nombre, servicio incluido, lavados y precio.
- Se venden **para una placa** desde la ficha del cliente (`POST /memberships`): copia del plan en `memberships`, dura **30 días** (`starts_on`…`ends_on`), lo no usado vence. La venta es un cobro **sin orden** (`payments.order_id` null, `membership_id`): entra a la caja y a las ventas, no cuenta como moto ni da comisión. No se vende otra mientras la vigente tenga lavados.
- Al cobrar una orden de esa moto con el servicio del plan: "Usar membresía" → `payments.covered` = precio del servicio base, `amount` = solo adicionales (− descuento). Si no hay nada que pagar, el medio es `MEMBRESIA` (no se confirma en el cierre). `orders.membership_id` marca el uso.
- Lavados usados = cobros vigentes con `covered > 0` de órdenes con esa membresía; anular el cobro devuelve el lavado. Anular la venta cancela la membresía (`cancelled_at`).
- **Comisión sobre el precio normal**: todo cálculo de comisión usa `p.amount + p.covered`. "Motos" cuenta solo cobros con orden (`count(*) filter (where p.order_id is not null)`).

## Comprobante de venta

- `/comprobante/:paymentId` (OWNER y ADMIN): comprobante imprimible de un cobro, con logo, placa, servicios, descuento, propina, medio de pago, recibido y cambio.
- "Enviar imagen por WhatsApp": `comprobante-imagen.ts` dibuja el comprobante a mano en un canvas (logo, textos, filas) y lo comparte como PNG con `navigator.share`; en computador se descarga. Se prepara al abrir, porque iPhone exige compartir justo al tocar.
- **No convertir el HTML a imagen** (html-to-image y similares): Safari no pinta el logo ni la letra. Para el canvas se usan los archivos fijos de Montserrat de `public/fonts` (500, 700 y 800 itálica, licencia OFL) con el nombre `MontserratRecibo`, porque la Montserrat variable de Google sale delgadísima en el canvas de Safari. Si cambia el comprobante en pantalla, cambiar también el dibujo. Un enlace `wa.me` no puede llevar imágenes, solo texto (queda como alternativa "Enviar como texto"). Si el cobro fue anulado sale la marca "ANULADO".
- Se abre solo al terminar un cobro; también desde la orden ("Ver comprobante") y desde Caja.
- **No es factura electrónica** y así lo dice el pie. La factura DIAN con Factus sigue pendiente.
- Al imprimir, `@media print` de `styles.css` oculta la barra superior y todo lo que tenga la clase `.no-imprimir`.

## Reglas del negocio que no se deben romper

- **Un cobro nunca se borra.** ADMIN pide la anulación (`void_status = REQUESTED`); OWNER aprueba o rechaza. Al aprobar, el cobro queda `APPROVED` (anulado) y la orden vuelve a `READY`.
- **Corregir un cobro** (`PATCH /payments/:id`, botón "Editar cobro" en el comprobante): medio de pago, descuento (cambia el valor), propina, referencia y efectivo recibido, con motivo obligatorio. ADMIN solo mientras el turno del cobro esté abierto; OWNER siempre (si el turno ya cerró, el cierre guardado no cambia, los reportes sí). No se editan cobros anulados ni con anulación pendiente, ni los servicios de la orden (para eso se anula y se cobra de nuevo). El antes y el después quedan en `audit_log` (`COBRO_EDITADO`) y el cobro muestra "Editado".
- Se cobra una orden abierta en **cualquier estado** (WAITING, WASHING o READY), desde la vista **Facturar** (`/facturar`), y solo con un **turno de caja abierto**. Un solo turno abierto a la vez. No se entrega sin cobro.
- **Descuento** al cobrar, en pesos o porcentaje (la pantalla lo convierte a pesos), con motivo obligatorio. `payments.amount` queda con el valor ya descontado y `payments.discount` / `discount_reason` guardan el descuento: ventas, caja y comisión usan lo que de verdad se cobró. Sale en el comprobante y en `audit_log`.
- Una orden con cobro activo no se puede cancelar ni modificar.
- **Comisión: 45%** de lo cobrado en cada orden que lavó la persona (incluye adicionales, descontado el descuento si lo hubo). Valor en `settings.commission_pct`.
- Propinas: se reparten por igual entre quienes lavaron en el turno (en la nómina, entre quienes lavaron ese día).
- Efectivo esperado = base + ventas y propinas en efectivo + entradas − gastos − retiros.
- Al cerrar se cuenta el efectivo y además se **confirma cada medio que tuvo cobros en el turno** (Nequi, Daviplata, transferencia, datáfono) contra lo esperado (ventas + propinas de ese medio). Si solo hubo efectivo, solo se pide el efectivo. Se guarda en `shifts.method_counts`. Si cualquier medio no cuadra, la explicación es obligatoria.
- Adicionales "desde" (óxido, desmanchado): se pueden cobrar por encima del precio base, nunca por debajo.
- El costo directo de los servicios (`services.direct_cost`) solo lo ve el OWNER.
- Toda acción sensible queda en `audit_log` con `audit()`.
- Dinero en **pesos enteros** (int). Fechas en **hora de Bogotá**: usar `TODAY` y `localDate()` de `db.ts` en el backend y el pipe `cuando` en el frontend.
- Fotos de recepción: se reducen en el navegador a JPEG de máximo 1280 px y se guardan en `order_photos` (bytea), máximo 6 por orden.

## Servicios (del manual interno)

Precios vigentes en producción (octubre 2026). Las migraciones siembran los precios originales; en producción se cambian desde Ajustes.

| Servicio | Precio | Tiempo objetivo | Costo directo |
| --- | --- | --- | --- |
| Shine Express (solo quitar barro: agua y trapo) | $10.000 | 10–15 min | $1.000 (estimado) |
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

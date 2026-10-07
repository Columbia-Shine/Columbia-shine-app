import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { audit, one, q, tx } from './db';
import { auth, HttpError, int, need, normPhone, optText, sign, text } from './auth';

export const cuentas = Router();

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

async function checkSecret(user: any, plain: string, hash: string | null) {
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new HttpError(429, `Demasiados intentos. Espera ${LOCK_MINUTES} minutos o pide al propietario que restablezca tu clave.`);
  }
  const ok = !!hash && (await bcrypt.compare(plain, hash));
  if (!ok) {
    const fails = user.failed_attempts + 1;
    const lock = fails >= MAX_FAILS;
    await q(
      `update users set failed_attempts = $2,
         locked_until = case when $3::boolean then now() + make_interval(mins => $4::int) else null end
       where id = $1`,
      [user.id, lock ? 0 : fails, lock, LOCK_MINUTES],
    );
    throw new HttpError(401, 'Los datos no coinciden.');
  }
  await q('update users set failed_attempts = 0, locked_until = null where id = $1', [user.id]);
}

const session = (u: any) => {
  const user = { id: u.id, name: u.name, role: u.role, customerId: u.customer_id };
  return { token: sign(user), user };
};

// Lista para la pantalla de PIN de la tablet del local
cuentas.get('/auth/staff', async (_req, res) => {
  res.json(await q(`select id, name, role from users where active and pin_hash is not null and role <> 'CLIENT' order by role, name`));
});

cuentas.post('/auth/login', async (req, res) => {
  const { email, password, userId, pin, phone } = req.body ?? {};
  let user: any;
  if (userId) {
    user = await one(`select * from users where id = $1 and active and role <> 'CLIENT'`, [String(userId)]);
    need(user, 'Los datos no coinciden.', 401);
    await checkSecret(user, String(pin ?? ''), user.pin_hash);
  } else if (email) {
    user = await one(`select * from users where lower(email) = lower($1) and active`, [String(email).trim()]);
    need(user, 'Los datos no coinciden.', 401);
    await checkSecret(user, String(password ?? ''), user.password_hash);
  } else {
    user = await one(`select * from users where phone = $1 and active and role = 'CLIENT'`, [normPhone(phone)]);
    need(user, 'Los datos no coinciden.', 401);
    await checkSecret(user, String(password ?? ''), user.password_hash);
  }
  res.json(session(user));
});

// Registro de clientes para agendar
cuentas.post('/auth/register', async (req, res) => {
  const name = text(req.body?.name, 'tu nombre', 80);
  const phone = normPhone(req.body?.phone);
  const password = String(req.body?.password ?? '');
  need(phone.length === 10, 'Escribe tu celular de 10 dígitos.');
  need(password.length >= 6, 'La clave debe tener al menos 6 caracteres.');
  need(!(await one('select 1 from users where phone = $1', [phone])), 'Ya hay una cuenta con ese celular. Ingresa con tu clave.', 409);
  const user = await tx(async (c) => {
    let customer = await one('select id from customers where phone = $1', [phone], c);
    if (!customer) customer = await one('insert into customers (name, phone) values ($1, $2) returning id', [name, phone], c);
    return one(
      `insert into users (name, role, phone, password_hash, customer_id) values ($1, 'CLIENT', $2, $3, $4) returning *`,
      [name, phone, await bcrypt.hash(password, 10), customer.id],
      c,
    );
  });
  res.status(201).json(session(user));
});

cuentas.get('/me', auth(), async (req, res) => {
  res.json(req.user);
});

// ---- Equipo (solo propietario) ----

cuentas.get('/users', auth('OWNER', 'ADMIN'), async (req, res) => {
  const rows = await q(
    `select id, name, role, email, active, pin_hash is not null as has_pin, password_hash is not null as has_password
     from users where role <> 'CLIENT' order by case role when 'OWNER' then 0 when 'ADMIN' then 1 else 2 end, name`,
  );
  // El administrador solo necesita nombres y roles para asignar motos
  res.json(req.user.role === 'OWNER' ? rows : rows.filter((r) => r.active).map(({ id, name, role }) => ({ id, name, role })));
});

const checkPin = (pin: unknown) => {
  const s = String(pin ?? '');
  need(/^\d{4}$/.test(s), 'El PIN debe tener 4 dígitos.');
  return s;
};

cuentas.post('/users', auth('OWNER'), async (req, res) => {
  const name = text(req.body?.name, 'el nombre', 80);
  const role = String(req.body?.role);
  need(['ADMIN', 'WASHER'].includes(role), 'Rol no válido.');
  const pin = checkPin(req.body?.pin);
  const email = optText(req.body?.email, 120);
  const password = optText(req.body?.password, 100);
  need(!password || password.length >= 8, 'La clave debe tener al menos 8 caracteres.');
  need(!email || !(await one('select 1 from users where lower(email) = lower($1)', [email])), 'Ya hay un usuario con ese correo.', 409);
  const u = await one(
    `insert into users (name, role, email, pin_hash, password_hash) values ($1, $2, $3, $4, $5) returning id, name, role`,
    [name, role, email, await bcrypt.hash(pin, 10), password ? await bcrypt.hash(password, 10) : null],
  );
  await audit(req.user.id, 'USUARIO_CREADO', 'user', u.id, { name, role });
  res.status(201).json(u);
});

cuentas.patch('/users/:id', auth('OWNER'), async (req, res) => {
  const u = await one('select * from users where id = $1', [req.params.id]);
  need(u && u.role !== 'CLIENT', 'Usuario no encontrado.', 404);
  const b = req.body ?? {};
  const changes: Record<string, unknown> = {};
  if (b.name !== undefined) changes.name = text(b.name, 'el nombre', 80);
  if (b.role !== undefined && u.role !== 'OWNER') {
    need(['ADMIN', 'WASHER'].includes(b.role), 'Rol no válido.');
    changes.role = b.role;
  }
  if (b.active !== undefined) {
    need(u.id !== req.user.id || b.active, 'No puedes desactivar tu propio usuario.');
    changes.active = !!b.active;
  }
  if (b.pin) changes.pin_hash = await bcrypt.hash(checkPin(b.pin), 10);
  if (b.password) {
    need(String(b.password).length >= 8, 'La clave debe tener al menos 8 caracteres.');
    changes.password_hash = await bcrypt.hash(String(b.password), 10);
  }
  if (b.email !== undefined) changes.email = optText(b.email, 120);
  const keys = Object.keys(changes);
  need(keys.length, 'No hay cambios.');
  await q(
    `update users set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, failed_attempts = 0, locked_until = null where id = $1`,
    [u.id, ...keys.map((k) => changes[k])],
  );
  await audit(req.user.id, 'USUARIO_EDITADO', 'user', u.id, { campos: keys.map((k) => k.replace('_hash', '')) });
  res.json({ ok: true });
});

// ---- Servicios y precios ----

cuentas.get('/services', auth(), async (req, res) => {
  const rows = await q(`select * from services ${req.user.role === 'OWNER' ? '' : 'where active'} order by sort`);
  // El costo directo es información del negocio: solo el propietario la ve
  res.json(req.user.role === 'OWNER' ? rows : rows.map(({ direct_cost, ...r }) => r));
});

cuentas.patch('/services/:id', auth('OWNER'), async (req, res) => {
  const s = await one('select * from services where id = $1', [req.params.id]);
  need(s, 'Servicio no encontrado.', 404);
  const price = req.body?.price !== undefined ? int(req.body.price, 'El precio', 1) : s.price;
  const active = req.body?.active !== undefined ? !!req.body.active : s.active;
  await q('update services set price = $2, active = $3 where id = $1', [s.id, price, active]);
  await audit(req.user.id, 'SERVICIO_EDITADO', 'service', s.id, { nombre: s.name, antes: s.price, ahora: price, activo: active });
  res.json({ ok: true });
});

cuentas.get('/audit', auth('OWNER'), async (_req, res) => {
  res.json(
    await q(
      `select a.id, a.action, a.entity, a.detail, a.created_at, u.name as user_name
       from audit_log a left join users u on u.id = a.user_id order by a.id desc limit 200`,
    ),
  );
});

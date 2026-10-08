import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { audit, one, q, tx } from './db';
import { auth, HttpError, int, need, normPhone, optText, sign, text, username } from './auth';

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

const MIN_STAFF_PASSWORD = 8;
const MIN_CLIENT_PASSWORD = 6;

// Todos entran con usuario (o correo) y contraseña: el equipo por /ingreso, los clientes por /cliente
cuentas.post('/auth/login', async (req, res) => {
  const login = String(req.body?.login ?? '').trim().toLowerCase();
  need(login, 'Escribe tu usuario o correo.');
  const user = await one(
    `select * from users where active and (lower(username) = $1 or lower(email) = $1) and (role = 'CLIENT') = $2`,
    [login, req.body?.staff !== true],
  );
  need(user, 'Los datos no coinciden.', 401);
  await checkSecret(user, String(req.body?.password ?? ''), user.password_hash);
  res.json(session(user));
});

const optEmail = (v: unknown): string | null => {
  const s = optText(v, 120)?.toLowerCase() ?? null;
  need(!s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), 'Revisa el correo.');
  return s;
};

const usernameFree = async (login: string, exceptId: string | null = null) =>
  need(!(await one('select 1 from users where lower(username) = $1 and id is distinct from $2', [login, exceptId])), 'Ese usuario ya existe. Elige otro.', 409);

const emailFree = async (email: string | null, exceptId: string | null = null) =>
  need(!email || !(await one('select 1 from users where lower(email) = $1 and id is distinct from $2', [email, exceptId])), 'Ya hay una cuenta con ese correo.', 409);

// Registro de clientes para agendar
cuentas.post('/auth/register', async (req, res) => {
  const name = text(req.body?.name, 'tu nombre', 80);
  const login = username(req.body?.username);
  const email = optEmail(req.body?.email);
  const phone = normPhone(req.body?.phone);
  const password = String(req.body?.password ?? '');
  need(phone.length === 10, 'Escribe tu celular de 10 dígitos.');
  need(password.length >= MIN_CLIENT_PASSWORD, `La clave debe tener al menos ${MIN_CLIENT_PASSWORD} caracteres.`);
  await usernameFree(login);
  await emailFree(email);
  need(!(await one('select 1 from users where phone = $1', [phone])), 'Ya hay una cuenta con ese celular. Ingresa con tu usuario.', 409);
  const user = await tx(async (c) => {
    let customer = await one('select id from customers where phone = $1', [phone], c);
    if (!customer) customer = await one('insert into customers (name, phone, email) values ($1, $2, $3) returning id', [name, phone, email], c);
    return one(
      `insert into users (name, role, username, email, phone, password_hash, customer_id) values ($1, 'CLIENT', $2, $3, $4, $5, $6) returning *`,
      [name, login, email, phone, await bcrypt.hash(password, 10), customer.id],
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
    `select id, name, role, username, email, active
     from users where role <> 'CLIENT' order by case role when 'OWNER' then 0 when 'ADMIN' then 1 else 2 end, name`,
  );
  // El administrador solo necesita nombres y roles para asignar motos
  res.json(req.user.role === 'OWNER' ? rows : rows.filter((r) => r.active).map(({ id, name, role }) => ({ id, name, role })));
});

const staffPassword = (v: unknown) => {
  const s = String(v ?? '');
  need(s.length >= MIN_STAFF_PASSWORD, `La contraseña debe tener al menos ${MIN_STAFF_PASSWORD} caracteres.`);
  return s;
};

cuentas.post('/users', auth('OWNER'), async (req, res) => {
  const name = text(req.body?.name, 'el nombre', 80);
  const role = String(req.body?.role);
  need(['ADMIN', 'WASHER'].includes(role), 'Rol no válido.');
  const login = username(req.body?.username);
  const password = staffPassword(req.body?.password);
  const email = optEmail(req.body?.email);
  await usernameFree(login);
  await emailFree(email);
  const u = await one(
    `insert into users (name, role, username, email, password_hash) values ($1, $2, $3, $4, $5) returning id, name, role`,
    [name, role, login, email, await bcrypt.hash(password, 10)],
  );
  await audit(req.user.id, 'USUARIO_CREADO', 'user', u.id, { name, role, usuario: login });
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
  if (b.username !== undefined) {
    changes.username = username(b.username);
    await usernameFree(changes.username as string, u.id);
  }
  if (b.password) changes.password_hash = await bcrypt.hash(staffPassword(b.password), 10);
  if (b.email !== undefined) {
    changes.email = optEmail(b.email);
    await emailFree(changes.email as string | null, u.id);
  }
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

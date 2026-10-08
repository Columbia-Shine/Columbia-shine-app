import bcrypt from 'bcryptjs';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, username } from './auth';
import { migrate, one, pool, q } from './db';
import { cuentas } from './routes-cuentas';
import { operacion } from './routes-operacion';
import { ordenes } from './routes-ordenes';

/** Crea el propietario la primera vez, con los datos de las variables de entorno. */
async function seedOwner() {
  if (await one(`select 1 from users where role = 'OWNER'`)) return;
  const { OWNER_USERNAME, OWNER_EMAIL, OWNER_PASSWORD, OWNER_NAME } = process.env;
  if (!OWNER_USERNAME || !OWNER_PASSWORD) {
    console.warn('No hay propietario: define OWNER_USERNAME y OWNER_PASSWORD y reinicia.');
    return;
  }
  if (OWNER_PASSWORD.length < 8) throw new Error('OWNER_PASSWORD debe tener al menos 8 caracteres');
  const login = username(OWNER_USERNAME);
  await q(`insert into users (name, role, username, email, password_hash) values ($1, 'OWNER', $2, $3, $4)`, [
    OWNER_NAME || 'Propietario', login, OWNER_EMAIL?.trim().toLowerCase() || null, await bcrypt.hash(OWNER_PASSWORD, 10),
  ]);
  console.log('Propietario creado:', login);
}

async function start() {
  await migrate();
  await seedOwner();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '12mb' })); // las fotos de recepción viajan en la orden

  const api = express.Router();
  api.get('/health', async (_req, res) => {
    await pool.query('select 1');
    res.json({ ok: true });
  });
  api.use(cuentas, ordenes, operacion);
  api.use((_req, _res) => {
    throw new HttpError(404, 'Ruta no encontrada.');
  });
  app.use('/api', api);

  // Un solo despliegue: Node sirve también la app de Angular ya compilada
  const web = path.resolve(__dirname, '../../web/dist/web/browser');
  if (fs.existsSync(web)) {
    app.use(express.static(web, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(web, 'index.html'));
    });
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Las fotos pesan demasiado. Toma menos fotos o de menor tamaño.' });
    if (err?.code === '22P02') return res.status(400).json({ error: 'Uno de los datos enviados no es válido.' });
    console.error(err);
    res.status(500).json({ error: 'Algo falló en el servidor. Intenta de nuevo.' });
  });

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Columbia Shine en el puerto ${port}`));
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});

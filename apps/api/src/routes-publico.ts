import { Router } from 'express';
import { audit, one, q } from './db';
import { auth, need, normPhone, optText, text } from './auth';

/** Página pública: lo que ve cualquier persona (sin sesión) y lo que el propietario edita. */
export const publico = Router();

type Site = {
  whatsapp: string; instagram: string; address: string; mapsUrl: string; googleReviewsUrl: string; about: string; instagramPosts: string[];
};
const EMPTY: Site = { whatsapp: '', instagram: '', address: '', mapsUrl: '', googleReviewsUrl: '', about: '', instagramPosts: [] };

async function site(): Promise<Site> {
  const row = await one(`select value from settings where key = 'site'`);
  return { ...EMPTY, ...(row?.value ?? {}) };
}

publico.get('/public/site', async (_req, res) => {
  const s = await site();
  const services = await q(
    `select id, name, kind, price, price_from, min_minutes, max_minutes, focus, steps, recommended from services where active order by kind, sort`,
  );
  const plans = await q(
    `select p.name, p.washes, p.price, s.name as service_name, s.price as service_price
     from membership_plans p join services s on s.id = p.service_id where p.active order by p.price`,
  );
  const reviews = await q(`select id, name, rating, comment, created_at from reviews where status = 'PUBLICADA' order by created_at desc limit 12`);
  const score = await one(`select round(avg(rating)::numeric, 1)::float as avg, count(*)::int as n from reviews where status = 'PUBLICADA'`);
  // Cifras reales del negocio (la página solo las muestra cuando ya son significativas)
  const stats = await one(
    `select (select count(*) from orders where status = 'DELIVERED')::int as bikes,
            (select count(*) from customers where not pending)::int as customers`,
  );
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ ...s, services, plans, reviews, score, stats });
});

// Opiniones: cualquiera puede dejar una; queda pendiente hasta que el propietario la publique.
// Límite sencillo por dirección para evitar spam.
const recent = new Map<string, number[]>();
publico.post('/public/reviews', async (req, res) => {
  const key = String(req.ip);
  const now = Date.now();
  const times = (recent.get(key) ?? []).filter((t) => now - t < 3600_000);
  need(times.length < 3, 'Ya recibimos tus opiniones. Gracias.', 429);
  const b = req.body ?? {};
  const name = text(b.name, 'tu nombre', 60);
  const rating = Number(b.rating);
  need(Number.isInteger(rating) && rating >= 1 && rating <= 5, 'Elige de 1 a 5 estrellas.');
  const comment = text(b.comment, 'tu comentario', 500);
  await q('insert into reviews (name, rating, comment) values ($1, $2, $3)', [name, rating, comment]);
  recent.set(key, [...times, now]);
  res.status(201).json({ ok: true });
});

// ---- Edición (propietario) ----

publico.get('/site-admin', auth('OWNER'), async (_req, res) => {
  res.json({ site: await site(), reviews: await q(`select * from reviews order by (status = 'PENDIENTE') desc, created_at desc limit 200`) });
});

publico.put('/site-admin', auth('OWNER'), async (req, res) => {
  const b = req.body ?? {};
  const url = (v: unknown) => {
    const s = optText(v, 500) ?? '';
    need(!s || /^https:\/\//.test(s), 'Los enlaces deben empezar por https://');
    return s;
  };
  const posts = (Array.isArray(b.instagramPosts) ? b.instagramPosts : [])
    .map((p: unknown) => String(p).trim())
    .filter(Boolean)
    .slice(0, 12);
  for (const p of posts) need(/^https:\/\/(www\.)?instagram\.com\/(p|reel)\/[\w-]+/.test(p), `Ese enlace no es de una publicación de Instagram: ${p}`);
  const phone = normPhone(b.whatsapp);
  need(!phone || phone.length === 10 || phone.length === 12, 'Escribe el WhatsApp de 10 dígitos.');
  const value: Site = {
    whatsapp: phone.length === 12 ? phone.slice(2) : phone,
    instagram: (optText(b.instagram, 60) ?? '').replace(/^@/, '').replace(/^https:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, ''),
    address: optText(b.address, 200) ?? '',
    mapsUrl: url(b.mapsUrl),
    googleReviewsUrl: url(b.googleReviewsUrl),
    about: optText(b.about, 1500) ?? '',
    instagramPosts: posts,
  };
  await q(`insert into settings (key, value) values ('site', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(value)]);
  await audit(req.user.id, 'PAGINA_EDITADA', 'settings', null, { campos: Object.keys(value) });
  res.json(value);
});

publico.patch('/reviews/:id', auth('OWNER'), async (req, res) => {
  const status = String(req.body?.status);
  need(['PUBLICADA', 'OCULTA', 'PENDIENTE'].includes(status), 'Estado no válido.');
  const r = await one('update reviews set status = $2 where id = $1 returning id, name, rating', [req.params.id, status]);
  need(r, 'Opinión no encontrada.', 404);
  await audit(req.user.id, 'OPINION_' + status, 'review', r.id, { nombre: r.name, estrellas: r.rating });
  res.json({ ok: true });
});

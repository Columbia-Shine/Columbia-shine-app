import { Router } from 'express';
import { audit, one, q } from './db';
import { auth, need, normPhone, optText, text } from './auth';

/** Página pública: lo que ve cualquier persona (sin sesión) y lo que el propietario edita. */
export const publico = Router();

type Promo = { title: string; text: string; until: string };
type Site = {
  whatsapp: string; instagram: string; address: string; mapsUrl: string; googleReviewsUrl: string; about: string; instagramPosts: string[];
  promos: Promo[]; business: { show: boolean; text: string };
};
const EMPTY: Site = {
  whatsapp: '', instagram: '', address: '', mapsUrl: '', googleReviewsUrl: '', about: '', instagramPosts: [],
  promos: [], business: { show: true, text: '' },
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Fotos de la página (sin los bytes): se sirven aparte con caché. */
async function images() {
  const rows = await q(`select id, kind, title, caption, before_data is not null as has_before, sort from site_images order by kind, sort, created_at`);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, caption: r.caption, sort: r.sort,
    url: `/api/public/images/${r.id}`, before: r.has_before ? `/api/public/images/${r.id}/antes` : null,
  }));
}

export async function site(): Promise<Site> {
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
  // Promociones vigentes (sin fecha o hasta hoy inclusive)
  const today = (await one(`select (now() at time zone 'America/Bogota')::date::text as d`)).d;
  const promos = s.promos.filter((p) => !p.until || p.until >= today);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ ...s, promos, services, plans, reviews, score, stats, images: await images() });
});

// Fotos de la página: no cambian (si se reemplazan, cambian de id), así que se guardan en caché
publico.get(['/public/images/:id', '/public/images/:id/antes'], async (req, res) => {
  const before = req.path.endsWith('/antes');
  const img = await one(`select mime, ${before ? 'before_data' : 'data'} as data from site_images where id = $1`, [String(req.params.id)]);
  need(img && img.data, 'Foto no encontrada.', 404);
  res.set('Content-Type', img.mime);
  res.set('Cache-Control', 'public, max-age=604800, immutable');
  res.send(img.data);
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
  res.json({ site: await site(), images: await images(), reviews: await q(`select * from reviews order by (status = 'PENDIENTE') desc, created_at desc limit 200`) });
});

const MAX_IMAGE = 2_500_000;
function decode(dataUrl: unknown, label: string): { mime: string; data: Buffer } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(dataUrl ?? ''));
  need(m, `No se pudo leer ${label}.`);
  const data = Buffer.from(m[2], 'base64');
  need(data.length <= MAX_IMAGE, `${label} pesa demasiado.`);
  return { mime: m[1], data };
}

publico.post('/site-images', auth('OWNER'), async (req, res) => {
  const b = req.body ?? {};
  const kind = String(b.kind);
  need(['ANTES_DESPUES', 'EQUIPO', 'PORTADA'].includes(kind), 'Tipo de foto no válido.');
  const main = decode(b.image, kind === 'ANTES_DESPUES' ? 'la foto del después' : 'la foto');
  const before = kind === 'ANTES_DESPUES' ? decode(b.before, 'la foto del antes') : null;
  const sort = Number((await one('select coalesce(max(sort), 0) + 1 as n from site_images where kind = $1', [kind])).n);
  // Solo hay una foto de portada: la nueva reemplaza la anterior
  if (kind === 'PORTADA') await q(`delete from site_images where kind = 'PORTADA'`);
  const img = await one(
    `insert into site_images (kind, title, caption, mime, data, before_data, sort) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [kind, optText(b.title, 80), optText(b.caption, 200), main.mime, main.data, before?.data ?? null, sort],
  );
  await audit(req.user.id, 'FOTO_PAGINA_SUBIDA', 'site_image', img.id, { tipo: kind, titulo: optText(b.title, 80) });
  res.status(201).json({ id: img.id });
});

publico.patch('/site-images/:id', auth('OWNER'), async (req, res) => {
  const img = await one('select id, title, caption, sort from site_images where id = $1', [req.params.id]);
  need(img, 'Foto no encontrada.', 404);
  const b = req.body ?? {};
  await q('update site_images set title = $2, caption = $3, sort = $4 where id = $1', [
    img.id,
    b.title === undefined ? img.title : optText(b.title, 80),
    b.caption === undefined ? img.caption : optText(b.caption, 200),
    b.sort === undefined ? img.sort : Number(b.sort) || 0,
  ]);
  res.json({ ok: true });
});

publico.delete('/site-images/:id', auth('OWNER'), async (req, res) => {
  const img = await one('delete from site_images where id = $1 returning id, kind, title', [req.params.id]);
  need(img, 'Foto no encontrada.', 404);
  await audit(req.user.id, 'FOTO_PAGINA_BORRADA', 'site_image', img.id, { tipo: img.kind, titulo: img.title });
  res.json({ ok: true });
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
    // Promociones: título, texto y hasta qué día (opcional)
    promos: (Array.isArray(b.promos) ? b.promos : []).slice(0, 6).map((p: any) => {
      const until = String(p?.until ?? '');
      need(!until || DAY.test(until), 'Revisa la fecha de la promoción.');
      return { title: text(p?.title, 'el título de la promoción', 80), text: optText(p?.text, 300) ?? '', until };
    }),
    business: { show: b.business?.show !== false, text: optText(b.business?.text, 600) ?? '' },
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

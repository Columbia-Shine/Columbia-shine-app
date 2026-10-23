import bcrypt from 'bcryptjs';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, username } from './auth';
import { migrate, one, pool, q } from './db';
import { cuentas } from './routes-cuentas';
import { finanzas } from './routes-finanzas';
import { inventario } from './routes-inventario';
import { membresias } from './routes-membresias';
import { publico, site } from './routes-publico';
import { nomina } from './routes-nomina';
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

/** Datos estructurados (schema.org AutoWash) con la información real del negocio, para buscadores. */
async function seoHead(origin: string): Promise<string> {
  const s = await site();
  const services = await q(`select name, price, kind, focus from services where active order by kind, sort`);
  const prices = services.filter((x) => x.kind === 'BASE').map((x) => x.price);
  const money = (n: number) => '$' + new Intl.NumberFormat('es-CO').format(n);
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'AutoWash',
    name: 'Columbia Shine',
    slogan: 'Pasión por tu máquina.',
    description: 'Lavado y detailing de motos en Bogotá. Agenda en línea, recibimos tu moto con fotos de su estado y te avisamos por WhatsApp cuando está lista.',
    url: origin + '/',
    image: origin + '/og-image.jpg',
    logo: origin + '/logo.png',
    areaServed: 'Bogotá',
    currenciesAccepted: 'COP',
    paymentAccepted: 'Efectivo, Nequi, Daviplata, Transferencia, Tarjeta',
    ...(prices.length ? { priceRange: `${money(Math.min(...prices))} - ${money(Math.max(...prices))}` } : {}),
    openingHoursSpecification: [
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '10:00', closes: '19:30' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Saturday', 'Sunday'], opens: '09:00', closes: '17:30' },
    ],
    address: { '@type': 'PostalAddress', ...(s.address ? { streetAddress: s.address } : {}), addressLocality: 'Bogotá', addressRegion: 'Bogotá D.C.', addressCountry: 'CO' },
    ...(s.whatsapp ? { telephone: '+57' + s.whatsapp } : {}),
    ...(s.instagram ? { sameAs: ['https://www.instagram.com/' + s.instagram] } : {}),
    ...(s.mapsUrl ? { hasMap: s.mapsUrl } : {}),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Servicios de lavado de motos',
      itemListElement: services.map((x) => ({
        '@type': 'Offer', price: x.price, priceCurrency: 'COP',
        itemOffered: { '@type': 'Service', name: x.name, ...(x.focus ? { description: x.focus } : {}) },
      })),
    },
  };
  // "<" escapado para que el JSON no pueda cerrar la etiqueta <script>
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return [
    `<link rel="canonical" href="${origin}/">`,
    `<meta property="og:url" content="${origin}/">`,
    `<script type="application/ld+json">${json}</script>`,
  ].join('\n');
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
  api.use(publico, cuentas, ordenes, operacion, nomina, finanzas, inventario, membresias);
  api.use((_req, _res) => {
    throw new HttpError(404, 'Ruta no encontrada.');
  });
  app.use('/api', api);

  // Un solo despliegue: Node sirve también la app de Angular ya compilada
  const web = path.resolve(__dirname, '../../web/dist/web/browser');
  if (fs.existsSync(web)) {
    // Buscadores: qué se indexa (solo lo público) y el mapa del sitio
    const origin = (req: Request) => `${req.protocol}://${req.get('host')}`;
    app.get('/robots.txt', (req, res) => {
      const internal = ['/inicio', '/recepcion', '/ordenes', '/facturar', '/cobro', '/comprobante', '/caja', '/agenda', '/clientes', '/inventario',
        '/reportes', '/mes', '/nomina', '/ajustes', '/pantalla', '/lavador', '/agendar', '/api/'];
      res.type('text/plain').send(['User-agent: *', 'Allow: /', ...internal.map((p) => `Disallow: ${p}`), `Sitemap: ${origin(req)}/sitemap.xml`, ''].join('\n'));
    });
    app.get('/sitemap.xml', (req, res) => {
      const urls = ['/', '/cliente'].map((p) => `<url><loc>${origin(req)}${p}</loc><changefreq>weekly</changefreq><priority>${p === '/' ? '1.0' : '0.6'}</priority></url>`);
      res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
    });

    app.use(express.static(web, { maxAge: '1h', index: false }));
    const indexHtml = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
    app.get(/^(?!\/api\/).*/, async (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      if (req.path !== '/') return res.type('html').send(indexHtml);
      // En la página pública van los datos del negocio para Google (ficha de negocio local) y la imagen para compartir
      try {
        res.type('html').send(indexHtml.replace('</head>', (await seoHead(origin(req))) + '</head>'));
      } catch {
        res.type('html').send(indexHtml);
      }
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

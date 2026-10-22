import { money, WhenPipe } from '../core';

/**
 * Dibuja el comprobante en un canvas y lo devuelve como PNG.
 * Se dibuja a mano (y no copiando el HTML) porque Safari en iPhone no pinta las imágenes ni la letra
 * de una página convertida a imagen: así sale igual en iPhone, Android y computador.
 */

const WIDTH = 380; // ancho del comprobante, igual que en pantalla
const PAD = 20;
const SCALE = 3; // nitidez en pantallas de celular
const FONT = 'MontserratRecibo, Montserrat, "Helvetica Neue", Arial, sans-serif';
const when = new WhenPipe();

/**
 * Montserrat en archivos fijos por peso (public/fonts, licencia OFL). La de Google es "variable" y
 * Safari la dibuja delgadísima en un canvas; con archivos fijos cada peso sale como debe.
 */
const FACES: [string, FontFaceDescriptors][] = [
  ['fonts/Montserrat-Medium.woff2', { weight: '500' }],
  ['fonts/Montserrat-Bold.woff2', { weight: '700' }],
  ['fonts/Montserrat-ExtraBoldItalic.woff2', { weight: '800', style: 'italic' }],
];
let facesReady: Promise<unknown> | null = null;

function loadFaces() {
  facesReady ??= Promise.all(
    FACES.map(async ([url, desc]) => {
      try {
        const face = await new FontFace('MontserratRecibo', `url(${url}) format('woff2')`, desc).load();
        document.fonts.add(face);
      } catch {
        // Sin la letra de la marca se usa la del sistema
      }
    }),
  );
  return facesReady;
}

type Ctx = CanvasRenderingContext2D;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Parte un texto en líneas que quepan en el ancho dado. */
function wrap(ctx: Ctx, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width <= max || !line) line = test;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function receiptImage(d: any, methods: Record<string, string>, logoSrc = 'logo.png'): Promise<Blob> {
  const [, logo] = await Promise.all([loadFaces(), loadImage(logoSrc)]);

  const o = d.order;
  const p = d.payment;
  const paid = p.amount + p.tip;

  // Se dibuja en un lienzo alto y al final se recorta a lo usado
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = 1400 * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, WIDTH, 1400);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.textBaseline = 'top';

  let y = 24;
  const inner = WIDTH - PAD * 2;

  const font = (weight: number, size: number, italic = false) => (ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`);

  const center = (text: string, weight = 500, size = 14, lh = 20, italic = false) => {
    font(weight, size, italic);
    ctx.textAlign = 'center';
    for (const line of wrap(ctx, text, inner)) {
      ctx.fillText(line, WIDTH / 2, y);
      y += lh;
    }
  };

  const dashed = () => {
    y += 8;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(WIDTH - PAD, y);
    ctx.stroke();
    ctx.restore();
    y += 10;
  };

  /** Fila con etiqueta a la izquierda y valor a la derecha; la etiqueta se parte si es larga. */
  const row = (label: string, value: string, opts: { bold?: boolean; size?: number } = {}) => {
    const size = opts.size ?? 14;
    const lh = Math.round(size * 1.45);
    font(opts.bold ? 700 : 500, size);
    const valueWidth = ctx.measureText(value).width;
    const labels = wrap(ctx, label, Math.max(inner - valueWidth - 12, 80));
    ctx.textAlign = 'right';
    ctx.fillText(value, WIDTH - PAD, y);
    ctx.textAlign = 'left';
    for (const line of labels) {
      ctx.fillText(line, PAD, y);
      y += lh;
    }
  };

  // Encabezado
  if (logo) {
    const h = 92;
    const w = (logo.width / logo.height) * h;
    ctx.drawImage(logo, (WIDTH - w) / 2, y, w, h);
    y += h + 8;
  }
  center('Columbia Shine', 800, 20, 28, true);
  center('Pasión por tu máquina.');
  center('Bogotá, Colombia');

  dashed();
  center(`Comprobante de venta ${o.code}`, 700);
  center(when.transform(p.created_at, 'completa'));
  dashed();

  row('Cliente', o.customer_name);
  if (o.customer_phone) row('Celular', o.customer_phone);
  row(o.plate.includes(',') ? 'Placas' : 'Placa', o.plate, { bold: true });
  if (o.brand || o.model) row('Moto', `${o.brand ?? ''} ${o.model ?? ''}`.trim());
  if (o.washer_name) row('Lavó', o.washer_name);

  dashed();
  for (const i of o.items) row(i.name, money(i.price));
  dashed();

  if (p.discount || p.covered) row('Subtotal', money(p.amount + p.discount + (p.covered ?? 0)));
  if (p.covered) row('Cubierto por membresía', '−' + money(p.covered));
  if (p.discount) {
    row(p.discount_reason ? `Descuento (${p.discount_reason})` : 'Descuento', '−' + money(p.discount));
  }
  row('Total servicios', money(p.amount));
  if (p.tip) row('Propina', money(p.tip));
  y += 4;
  row('Total pagado', money(paid), { bold: true, size: 18 });
  row('Medio de pago', methods[p.method] ?? p.method);
  if (p.cash_received !== null && p.cash_received !== undefined) {
    row('Recibido', money(p.cash_received));
    row('Cambio', money(p.cash_received - paid));
  }
  if (p.reference) row('Referencia', p.reference);
  row('Atendió', p.created_by_name);

  dashed();
  center('¡Gracias por tu visita!');
  center('Este comprobante no es una factura electrónica de venta.', 500, 11, 16);
  y += 20;

  if (p.void_status === 'APPROVED') {
    ctx.save();
    ctx.translate(WIDTH / 2, y * 0.45);
    ctx.rotate((-20 * Math.PI) / 180);
    font(800, 48);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(200, 0, 0, 0.35)';
    ctx.fillText('ANULADO', 0, 0);
    ctx.restore();
  }

  // Recorta al alto usado
  const out = document.createElement('canvas');
  out.width = WIDTH * SCALE;
  out.height = Math.ceil(y * SCALE);
  out.getContext('2d')!.drawImage(canvas, 0, 0);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo crear la imagen'))), 'image/png'));
}

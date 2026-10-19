import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, METHOD_NAMES, money, MoneyPipe, Toast, WhenPipe } from '../core';
import { receiptImage } from './comprobante-imagen';

/** Comprobante de venta de un cobro: para imprimir o enviar por WhatsApp. No es factura electrónica. */
@Component({
  selector: 'app-comprobante',
  imports: [RouterLink, MoneyPipe, WhenPipe],
  template: `
    <main class="page narrow">
      @if (data(); as d) {
        <div class="col no-imprimir" style="gap: 10px">
          <button class="btn primario grande" [disabled]="!image()" (click)="share()">{{ image() ? 'Enviar imagen por WhatsApp' : 'Preparando imagen…' }}</button>
          <div class="row">
            <button class="btn grow" (click)="print()">Imprimir</button>
            <a class="btn grow" routerLink="/facturar">Volver a facturar</a>
          </div>
        </div>
        <p class="chico suave no-imprimir" style="text-align: center">
          En el celular se abre el menú de compartir: elige WhatsApp y el contacto.
          ¿No funciona? <a [href]="whatsapp()" target="_blank" rel="noopener">Enviar como texto</a>
        </p>

        <article class="recibo" aria-label="Comprobante de venta">
          @if (d.payment.void_status === 'APPROVED') {
            <div class="anulado">ANULADO</div>
          }
          <header class="centro">
            <img src="logo.png" alt="Columbia Shine" width="96" height="92" />
            <div class="marca">Columbia Shine</div>
            <div>Pasión por tu máquina.</div>
            <div>Medellín, Colombia</div>
          </header>

          <div class="linea"></div>
          <div class="centro fuerte">Comprobante de venta {{ d.order.code }}</div>
          <div class="centro">{{ d.payment.created_at | cuando: 'completa' }}</div>
          <div class="linea"></div>

          <div class="fila"><span>Cliente</span><span>{{ d.order.customer_name }}</span></div>
          @if (d.order.customer_phone) { <div class="fila"><span>Celular</span><span>{{ d.order.customer_phone }}</span></div> }
          <div class="fila"><span>Placa</span><span class="fuerte">{{ d.order.plate }}</span></div>
          @if (d.order.brand || d.order.model) { <div class="fila"><span>Moto</span><span>{{ d.order.brand }} {{ d.order.model }}</span></div> }
          @if (d.order.washer_name) { <div class="fila"><span>Lavó</span><span>{{ d.order.washer_name }}</span></div> }

          <div class="linea"></div>
          @for (i of d.order.items; track i.id) {
            <div class="fila"><span>{{ i.name }}</span><span class="num">{{ i.price | money }}</span></div>
          }
          <div class="linea"></div>
          @if (d.payment.discount) {
            <div class="fila"><span>Subtotal</span><span class="num">{{ d.payment.amount + d.payment.discount | money }}</span></div>
            <div class="fila"><span>Descuento @if (d.payment.discount_reason) { ({{ d.payment.discount_reason }}) }</span><span class="num">−{{ d.payment.discount | money }}</span></div>
          }
          <div class="fila"><span>Total servicios</span><span class="num">{{ d.payment.amount | money }}</span></div>
          @if (d.payment.tip) { <div class="fila"><span>Propina</span><span class="num">{{ d.payment.tip | money }}</span></div> }
          <div class="fila total"><span>Total pagado</span><span class="num">{{ paid() | money }}</span></div>
          <div class="fila"><span>Medio de pago</span><span>{{ methods[d.payment.method] }}</span></div>
          @if (d.payment.cash_received !== null) {
            <div class="fila"><span>Recibido</span><span class="num">{{ d.payment.cash_received | money }}</span></div>
            <div class="fila"><span>Cambio</span><span class="num">{{ d.payment.cash_received - paid() | money }}</span></div>
          }
          @if (d.payment.reference) { <div class="fila"><span>Referencia</span><span>{{ d.payment.reference }}</span></div> }
          <div class="fila"><span>Atendió</span><span>{{ d.payment.created_by_name }}</span></div>

          <div class="linea"></div>
          <p class="centro">¡Gracias por tu visita!</p>
          <p class="centro chiquito">Este comprobante no es una factura electrónica de venta.</p>
        </article>
      } @else {
        <p class="vacio">Cargando…</p>
      }
    </main>
  `,
  styles: `
    .recibo { position: relative; width: 100%; max-width: 380px; margin: 0 auto; padding: 24px 20px; border-radius: 6px; background: #fff; color: #000; font-size: 14px; line-height: 1.45; }
    .centro { text-align: center; }
    .centro img { margin: 0 auto 6px; display: block; }
    .marca { font-size: 20px; font-weight: 800; font-style: italic; }
    .linea { margin: 10px 0; border-top: 1px dashed #000; }
    .fila { display: flex; justify-content: space-between; gap: 12px; }
    .fila span:last-child { text-align: right; }
    .recibo .total { margin-top: 4px; font-size: 18px; font-weight: 800; color: #000; }
    .chiquito { font-size: 11px; }
    .anulado { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-size: 48px; font-weight: 800; color: rgba(200, 0, 0, 0.35); transform: rotate(-20deg); pointer-events: none; }
  `,
})
export class Comprobante {
  private api = inject(Api);
  private toast = inject(Toast);
  private id = inject(ActivatedRoute).snapshot.paramMap.get('id')!;

  protected methods = METHOD_NAMES;
  protected data = signal<any | null>(null);
  protected paid = computed(() => (this.data()?.payment.amount ?? 0) + (this.data()?.payment.tip ?? 0));

  /** Resumen en texto para mandarlo por WhatsApp al cliente. */
  protected whatsapp = computed(() => {
    const d = this.data();
    if (!d) return '';
    const o = d.order;
    const p = d.payment;
    const lines = [
      `*Columbia Shine* · Comprobante ${o.code}`,
      `Placa ${o.plate}`,
      ...o.items.map((i: any) => `${i.name}: ${money(i.price)}`),
      ...(p.discount ? [`Descuento: −${money(p.discount)}`] : []),
      ...(p.tip ? [`Propina: ${money(p.tip)}`] : []),
      `*Total pagado: ${money(this.paid())}* (${this.methods[p.method]})`,
      '¡Gracias por tu visita! Pasión por tu máquina.',
    ];
    const to = o.customer_phone ? '57' + o.customer_phone : '';
    return `https://wa.me/${to}?text=${encodeURIComponent(lines.join('\n'))}`;
  });

  /** El comprobante como imagen PNG, listo antes del toque para que el celular deje compartirlo. */
  protected image = signal<File | null>(null);

  constructor() {
    this.api.get(`/payments/${this.id}/receipt`).then(async (d) => {
      this.data.set(d);
      try {
        const blob = await receiptImage(d, this.methods);
        this.image.set(new File([blob], `comprobante-${d.order.code}.png`, { type: 'image/png' }));
      } catch {
        this.toast.show('No se pudo preparar la imagen. Usa "Enviar como texto".', true);
      }
    }, this.toast.fail);
  }

  /** Abre el menú de compartir del celular con la imagen; en computador la descarga. */
  async share() {
    const file = this.image();
    if (!file) return;
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Comprobante Columbia Shine' });
      } catch (e: any) {
        if (e?.name !== 'AbortError') this.toast.show('No se pudo compartir. Descarga la imagen e intenta de nuevo.', true);
      }
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.show('Imagen descargada. Adjúntala en WhatsApp.');
  }

  print() {
    window.print();
  }
}

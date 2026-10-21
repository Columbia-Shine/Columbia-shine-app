import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, METHOD_NAMES, MoneyPipe, STATUS_NAMES, Toast, WhenPipe } from '../core';

/** Facturar: todo lo que falta por cobrar, sin importar en qué estado va la moto, y lo cobrado en el turno. */
@Component({
  selector: 'app-facturar',
  imports: [FormsModule, RouterLink, MoneyPipe, WhenPipe],
  template: `
    <main class="page">
      <div class="row between">
        <h1>Facturar</h1>
        <div class="row">
          <input class="campo" style="max-width: 280px" type="search" placeholder="Buscar placa o cliente" aria-label="Buscar placa o cliente" [(ngModel)]="term" />
          <a class="btn primario chico" routerLink="/recepcion">+ Recibir moto</a>
        </div>
      </div>

      @if (shiftChecked() && !shiftOpen()) {
        <div class="aviso alerta row between">
          <span>No hay turno de caja abierto. Ábrelo para poder cobrar.</span>
          <a class="btn chico" routerLink="/caja">Ir a Caja</a>
        </div>
      }

      <section class="card col">
        <div class="row between">
          <h2>Por cobrar</h2>
          <span class="suave">{{ pending().length }} · <span class="fuerte amarillo">{{ pendingTotal() | money }}</span></span>
        </div>
        <div class="tabla-caja">
          <table style="min-width: 640px">
            <thead><tr><th>Orden</th><th>Placa</th><th>Cliente</th><th>Servicio</th><th>Estado</th><th>Lavador</th><th class="der">Total</th><th></th></tr></thead>
            <tbody>
              @for (o of pending(); track o.id) {
                <tr>
                  <td><a [routerLink]="['/ordenes', o.id]">{{ o.code }}</a></td>
                  <td class="fuerte">{{ o.plate }}</td>
                  <td>{{ o.customer_name }}</td>
                  <td>{{ describe(o) }}</td>
                  <td><span class="etiqueta" [class.amarilla]="o.status === 'READY'">{{ names[o.status] }}</span></td>
                  <td>{{ o.washer_name || '—' }}</td>
                  <td class="der fuerte">{{ o.total | money }}</td>
                  <td class="der"><a class="btn chico primario" [routerLink]="['/cobro', o.id]">Cobrar</a></td>
                </tr>
              } @empty {
                <tr><td colspan="8" class="suave">{{ term() ? 'Nada coincide con la búsqueda.' : 'No hay motos pendientes de cobro.' }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="card col">
        <div class="row between">
          <h2>{{ shiftOpen() ? 'Cobrado en este turno' : 'Cobrado hoy' }}</h2>
          <span class="suave">{{ paid().length }} · <span class="fuerte">{{ paidTotal() | money }}</span></span>
        </div>
        <div class="tabla-caja">
          <table style="min-width: 600px">
            <thead><tr><th>Hora</th><th>Orden</th><th>Placa</th><th>Medio</th><th>Cobró</th><th class="der">Valor</th><th></th></tr></thead>
            <tbody>
              @for (p of paid(); track p.id) {
                <tr [style.opacity]="p.void_status === 'APPROVED' ? 0.55 : 1">
                  <td>{{ p.created_at | cuando }}</td>
                  <td><a [routerLink]="['/ordenes', p.order_id]">{{ p.code }}</a></td>
                  <td class="fuerte">{{ p.plate }}</td>
                  <td>{{ methods[p.method] }} @if (p.edited_at) { <span class="etiqueta">Editado</span> }</td>
                  <td>{{ p.created_by_name }}</td>
                  <td class="der fuerte">
                    @if (p.void_status === 'APPROVED') { <span class="etiqueta" style="margin-right: 6px">Anulado</span> }
                    {{ p.amount + p.tip | money }}
                  </td>
                  <td class="der"><a class="btn chico" [routerLink]="['/comprobante', p.id]">Comprobante</a></td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="suave">Todavía no hay cobros.</td></tr>
              }
            </tbody>
          </table>
        </div>
        <p class="chico suave">El valor incluye la propina. Para anular un cobro ve a Caja.</p>
      </section>
    </main>
  `,
})
export class Facturar implements OnDestroy {
  private api = inject(Api);
  private toast = inject(Toast);

  protected names = STATUS_NAMES;
  protected methods = METHOD_NAMES;
  protected term = signal('');
  protected orders = signal<any[]>([]);
  protected payments = signal<any[]>([]);
  protected shiftOpen = signal(false);
  protected shiftChecked = signal(false);
  private timer = setInterval(() => this.load(), 30000);

  private matches = (...values: (string | null | undefined)[]) => {
    const t = this.term().trim().toLowerCase();
    return !t || values.some((v) => (v ?? '').toLowerCase().includes(t));
  };

  protected pending = computed(() => this.orders().filter((o) => !o.payment_id && this.matches(o.plate, o.customer_name, o.code)));
  protected pendingTotal = computed(() => this.pending().reduce((a, o) => a + o.total, 0));
  protected paid = computed(() => this.payments().filter((p) => this.matches(p.plate, p.code)));
  protected paidTotal = computed(() => this.paid().filter((p) => p.void_status !== 'APPROVED').reduce((a, p) => a + p.amount + p.tip, 0));

  constructor() {
    this.load();
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  describe = (o: any): string => o.items.map((i: any) => i.name).join(' + ');

  private async load() {
    try {
      const [orders, payments, shift] = await Promise.all([this.api.get('/orders?scope=active'), this.api.get('/payments'), this.api.get('/shifts/current')]);
      this.orders.set(orders);
      this.payments.set(payments);
      this.shiftOpen.set(!!shift);
      this.shiftChecked.set(true);
    } catch (e) {
      this.toast.fail(e);
    }
  }
}

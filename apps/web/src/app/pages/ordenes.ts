import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, minutesSince, MoneyPipe, STATUS_NAMES, Toast, WhenPipe } from '../core';

const COLUMNS = ['WAITING', 'WASHING', 'REVIEW', 'READY'];

@Component({
  selector: 'app-ordenes',
  imports: [RouterLink, MoneyPipe, WhenPipe],
  template: `
    <main class="page" style="max-width: none">
      <div class="row between">
        <h1>Motos en el local</h1>
        <div class="row">
          <button class="pastilla" [attr.aria-pressed]="scope() === 'active'" (click)="setScope('active')">Activas</button>
          <button class="pastilla" [attr.aria-pressed]="scope() === 'today'" (click)="setScope('today')">Cerradas hoy</button>
          <a class="btn primario chico" routerLink="/recepcion">+ Recibir moto</a>
        </div>
      </div>

      @if (scope() === 'active') {
        <div class="tabla-caja">
          <div class="tablero">
            @for (col of columns(); track col.status) {
              <section class="card columna">
                <div class="row between">
                  <h2 class="rotulo" style="color: #fff; font-size: 14px">{{ names[col.status] }}</h2>
                  <span class="etiqueta">{{ col.orders.length }}</span>
                </div>
                @for (o of col.orders; track o.id) {
                  <article class="tile tarjeta" [class.tarde]="late(o)">
                    <div class="row between chico suave">
                      <a [routerLink]="['/ordenes', o.id]">{{ o.code }}</a>
                      <span class="num fuerte" [class.amarillo]="late(o)">{{ elapsed(o) }}</span>
                    </div>
                    <div class="placa">{{ o.plate }}</div>
                    <div class="chico">{{ o.brand }} {{ o.model }} · {{ o.customer_name }}</div>
                    <div class="servicio">{{ o.service_name }}</div>
                    @if (extras(o); as x) { <div class="chico suave">+ {{ x }}</div> }
                    <div class="row between" style="margin-top: 4px">
                      <span class="chico suave">{{ o.washer_name || 'Sin asignar' }}</span>
                      @switch (action(o)) {
                        @case ('assign') { <a class="btn chico" [routerLink]="['/ordenes', o.id]">Asignar</a> }
                        @case ('start') { <button class="btn chico" (click)="move(o, 'WASHING')">Iniciar</button> }
                        @case ('review') { <a class="btn chico azul" [routerLink]="['/ordenes', o.id]">Revisar</a> }
                        @case ('pay') { <a class="btn chico primario" [routerLink]="['/cobro', o.id]">Cobrar {{ o.total | money }}</a> }
                        @default { <a class="btn chico" [routerLink]="['/ordenes', o.id]">Ver</a> }
                      }
                    </div>
                  </article>
                } @empty {
                  <p class="chico suave" style="padding: 8px 0">Sin motos aquí.</p>
                }
              </section>
            }
          </div>
        </div>
        <p class="chico suave">El tiempo se pone amarillo cuando la moto supera el tiempo objetivo de su servicio. Para pasar a "Lista para entregar" se completa la revisión de entrega dentro de la orden.</p>
      } @else {
        <section class="card tabla-caja">
          <table>
            <thead><tr><th>Orden</th><th>Placa</th><th>Cliente</th><th>Servicio</th><th>Lavador</th><th>Estado</th><th>Hora</th><th class="der">Valor</th></tr></thead>
            <tbody>
              @for (o of orders(); track o.id) {
                <tr>
                  <td><a [routerLink]="['/ordenes', o.id]">{{ o.code }}</a></td>
                  <td class="fuerte">{{ o.plate }}</td>
                  <td>{{ o.customer_name }}</td>
                  <td>{{ o.service_name }}</td>
                  <td>{{ o.washer_name || '—' }}</td>
                  <td><span class="etiqueta" [class.azul]="o.status === 'DELIVERED'">{{ names[o.status] }}</span></td>
                  <td>{{ o.delivered_at || o.created_at | cuando }}</td>
                  <td class="der fuerte">{{ o.total | money }}</td>
                </tr>
              } @empty {
                <tr><td colspan="8" class="suave">Todavía no se ha entregado ni cancelado ninguna moto hoy.</td></tr>
              }
            </tbody>
          </table>
        </section>
      }
    </main>
  `,
  styles: `
    .tablero { display: grid; grid-template-columns: repeat(4, minmax(270px, 1fr)); gap: 14px; min-width: 1120px; align-items: start; }
    .columna { display: flex; flex-direction: column; gap: 12px; padding: 14px; }
    .tarjeta { display: flex; flex-direction: column; gap: 6px; border-top: 4px solid var(--azul); }
    .tarjeta.tarde { border-top-color: var(--amarillo); }
    .servicio { font-weight: 800; font-style: italic; color: var(--azul-claro); }
  `,
})
export class Ordenes implements OnDestroy {
  private api = inject(Api);
  private toast = inject(Toast);

  protected names = STATUS_NAMES;
  protected scope = signal<'active' | 'today'>('active');
  protected orders = signal<any[]>([]);
  protected columns = computed(() => COLUMNS.map((status) => ({ status, orders: this.orders().filter((o) => o.status === status) })));
  private timer = setInterval(() => this.load(), 20000);

  constructor() {
    this.load();
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  setScope(scope: 'active' | 'today') {
    this.scope.set(scope);
    this.orders.set([]);
    this.load();
  }

  load() {
    const scope = this.scope();
    this.api.get('/orders?scope=' + scope).then((o) => {
      if (this.scope() === scope) this.orders.set(o);
    }, this.toast.fail);
  }

  /** Minutos que cuentan para la alerta: desde que empezó el lavado. */
  private washMinutes = (o: any) => (o.status === 'WASHING' ? minutesSince(o.started_at) : 0);
  late = (o: any) => !!o.max_minutes && this.washMinutes(o) > o.max_minutes;

  elapsed(o: any): string {
    if (o.status === 'WASHING') return this.washMinutes(o) + ' min';
    if (o.status === 'READY') return 'hace ' + minutesSince(o.ready_at) + ' min';
    return minutesSince(o.status === 'REVIEW' ? o.finished_at : o.created_at) + ' min';
  }

  extras = (o: any): string => o.items.filter((i: any) => i.kind === 'EXTRA').map((i: any) => i.name).join(', ');

  action(o: any): string {
    if (o.status === 'WAITING') return o.washer_id ? 'start' : 'assign';
    if (o.status === 'REVIEW') return 'review';
    if (o.status === 'READY') return 'pay';
    return 'view';
  }

  async move(o: any, status: string) {
    try {
      await this.api.post(`/orders/${o.id}/status`, { status });
      this.load();
    } catch (e) {
      this.toast.fail(e);
    }
  }
}

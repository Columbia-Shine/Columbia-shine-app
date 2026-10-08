import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, METHOD_NAMES, minutesSince, money, MoneyInput, MoneyPipe, STATUS_NAMES, Toast, WhenPipe } from '../core';

@Component({
  selector: 'app-orden',
  imports: [FormsModule, RouterLink, MoneyInput, MoneyPipe, WhenPipe],
  template: `
    <main class="page">
      @if (order(); as o) {
        <div class="row between">
          <div>
            <p class="rotulo">Orden {{ o.code }} · recibida {{ o.created_at | cuando: 'completa' }}</p>
            <h1>{{ o.plate }} · {{ o.brand }} {{ o.model }}</h1>
            <p class="suave" style="margin-top: 6px">
              <a [routerLink]="['/clientes', o.customer_id]">{{ o.customer_name }}</a>
              @if (o.customer_phone) { · {{ o.customer_phone }} } · {{ o.service_name }}
            </p>
          </div>
          <span class="etiqueta" [class.amarilla]="o.status === 'READY'" [class.azul]="o.status !== 'READY'" style="font-size: 14px; padding: 8px 14px">{{ names[o.status] }}</span>
        </div>

        <div class="split">
          <div class="main col" style="gap: 20px">
            @if (open()) {
              <section class="card col">
                <h2>Siguiente paso</h2>
                @switch (o.status) {
                  @case ('WAITING') {
                    <p class="suave">{{ o.washer_id ? 'Asignada a ' + o.washer_name + '. Él la inicia desde su celular, o la inicias tú aquí.' : 'Asigna un lavador para poder iniciar.' }}</p>
                    <button class="btn primario" [disabled]="!o.washer_id || busy()" (click)="move('WASHING')">Iniciar lavado</button>
                  }
                  @case ('WASHING') {
                    <p class="suave">En lavado hace {{ since(o.started_at) }} min. Tiempo objetivo: {{ o.min_minutes }}–{{ o.max_minutes }} min.</p>
                    <button class="btn primario" [disabled]="busy()" (click)="move('READY')">Terminó: lista para entregar</button>
                  }
                  @case ('READY') {
                    <p class="suave">Lista hace {{ since(o.ready_at) }} min.</p>
                    <div class="row">
                      <a class="btn primario grande" [routerLink]="['/cobro', o.id]">Cobrar {{ o.total | money }}</a>
                      <button class="btn" [disabled]="busy()" (click)="move('WASHING')">Devolver a lavado</button>
                    </div>
                  }
                }
              </section>

              @if (o.status !== 'READY') {
                <section class="card col">
                  <h2>Lavador</h2>
                  <div class="grid-sm">
                    @for (w of washers(); track w.id) {
                      <button class="opcion" [attr.aria-pressed]="o.washer_id === w.id" [disabled]="busy()" (click)="assign(w.id)">{{ w.name }}</button>
                    }
                  </div>
                </section>
              }
            }

            <section class="card col">
              <h2>Estado al recibir</h2>
              @if (o.photos.length) {
                <div class="fotos">
                  @for (p of o.photos; track p.id) { <a [href]="p.url" target="_blank" rel="noopener"><img [src]="p.url" alt="Foto de la moto al recibir" /></a> }
                </div>
              } @else {
                <p class="suave chico">No se tomaron fotos en la recepción.</p>
              }
              <p>{{ o.notes || 'Sin observaciones.' }}</p>
            </section>

            @if (open() && !o.payment_id) {
              <section class="card col">
                <h2>Cancelar orden</h2>
                <p class="chico suave">Solo para órdenes sin cobro. Pide un motivo y queda en el historial a tu nombre.</p>
                <div class="row">
                  <input class="campo grow" style="flex-basis: 240px" placeholder="Motivo" aria-label="Motivo de la cancelación" [(ngModel)]="cancelReason" />
                  <button class="btn" [disabled]="busy()" (click)="cancel()">Cancelar orden</button>
                </div>
              </section>
            }
            @if (o.status === 'CANCELLED') {
              <div class="aviso">Cancelada: {{ o.cancel_reason }}</div>
            }
          </div>

          <aside class="card side col">
            <h2>Detalle</h2>
            @for (i of o.items; track i.id) {
              <div class="row between">
                <span [class.fuerte]="i.kind === 'BASE'" [class.suave]="i.kind !== 'BASE'">{{ i.name }}</span>
                <span class="row" style="gap: 8px">
                  <span class="num">{{ i.price | money }}</span>
                  @if (i.kind === 'EXTRA' && editable()) {
                    <button class="btn chico" [attr.aria-label]="'Quitar ' + i.name" [disabled]="busy()" (click)="removeItem(i.id)">Quitar</button>
                  }
                </span>
              </div>
            }
            <div class="row between sep"><span class="fuerte">Total</span><span class="total">{{ o.total | money }}</span></div>
            @if (editable()) {
              <div class="sep col">
                <label for="extra" style="margin: 0">Agregar adicional</label>
                <select id="extra" class="campo" [(ngModel)]="extraId">
                  <option value="">Elegir…</option>
                  @for (e of extras(); track e.id) { <option [value]="e.id">{{ e.name }} · {{ e.price_from ? 'desde ' : '' }}{{ e.price | money }}</option> }
                </select>
                @if (extra()?.price_from) {
                  <div>
                    <label for="precio">Valor acordado con el cliente</label>
                    <input id="precio" class="campo" dinero [placeholder]="'Mínimo ' + (extra().price | money)" [(ngModel)]="extraPrice" />
                  </div>
                }
                <button class="btn" [disabled]="!extraId() || busy()" (click)="addItem()">Agregar</button>
                <p class="chico suave">Informa el precio al cliente antes de hacer cualquier adicional.</p>
              </div>
            }
          </aside>
        </div>
      } @else {
        <p class="vacio">Cargando…</p>
      }
    </main>
  `,
})
export class Orden {
  private api = inject(Api);
  private toast = inject(Toast);
  private router = inject(Router);
  private id = inject(ActivatedRoute).snapshot.paramMap.get('id')!;

  protected names = STATUS_NAMES;
  protected since = minutesSince;
  protected order = signal<any | null>(null);
  protected washers = signal<any[]>([]);
  protected services = signal<any[]>([]);
  protected busy = signal(false);
  protected cancelReason = signal('');
  protected extraId = signal('');
  protected extraPrice = signal<number | null>(null);

  protected open = computed(() => ['WAITING', 'WASHING', 'REVIEW', 'READY'].includes(this.order()?.status));
  protected editable = computed(() => this.open() && !this.order()?.payment_id);
  protected extras = computed(() => this.services().filter((s) => s.kind === 'EXTRA'));
  protected extra = computed(() => this.extras().find((e) => e.id === this.extraId()));

  constructor() {
    this.load();
    Promise.all([this.api.get('/users'), this.api.get('/services')]).then(([u, s]) => {
      this.washers.set(u.filter((x: any) => x.role !== 'OWNER'));
      this.services.set(s);
    }, this.toast.fail);
  }

  private load() {
    this.api.get('/orders/' + this.id).then((o) => this.order.set(o), this.toast.fail);
  }

  /** Ejecuta una acción sobre la orden y refresca lo que se ve en pantalla. */
  private async run(action: () => Promise<any>, done?: string) {
    this.busy.set(true);
    try {
      const updated = await action();
      if (updated?.id) this.order.update((o) => ({ ...updated, photos: o?.photos ?? [] }));
      if (done) this.toast.show(done);
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  move = (status: string) => this.run(() => this.api.post(`/orders/${this.id}/status`, { status }));
  assign = (washerId: string) => this.run(() => this.api.post(`/orders/${this.id}/assign`, { washerId }), 'Lavador asignado. Ya le aparece en su celular.');
  removeItem = (itemId: string) => this.run(() => this.api.del(`/orders/${this.id}/items/${itemId}`));

  addItem() {
    const price = this.extra()?.price_from && this.extraPrice() ? Number(this.extraPrice()) : undefined;
    this.run(async () => {
      const o = await this.api.post(`/orders/${this.id}/items`, { serviceId: this.extraId(), price });
      this.extraId.set('');
      this.extraPrice.set(null);
      return o;
    }, 'Adicional agregado.');
  }

  async cancel() {
    if (!this.cancelReason().trim()) return this.toast.show('Escribe el motivo de la cancelación.', true);
    await this.run(async () => {
      await this.api.post(`/orders/${this.id}/cancel`, { reason: this.cancelReason() });
      this.router.navigateByUrl('/ordenes');
    }, 'Orden cancelada.');
  }
}

const METHODS = ['EFECTIVO', 'NEQUI', 'DAVIPLATA', 'TRANSFERENCIA', 'DATAFONO'];

@Component({
  selector: 'app-cobro',
  imports: [FormsModule, RouterLink, MoneyInput, MoneyPipe],
  template: `
    <main class="page">
      <h1>Cobrar y entregar</h1>
      @if (order(); as o) {
        <div class="split">
          <section class="card side col" style="flex-basis: 380px">
            <div class="row between chico suave"><span>Orden {{ o.code }}</span><span>Lavó {{ o.washer_name || '—' }}</span></div>
            <div class="placa" style="font-size: 26px">{{ o.plate }}</div>
            <div>{{ o.brand }} {{ o.model }} · {{ o.customer_name }}</div>
            <div class="sep col" style="gap: 8px">
              @for (i of o.items; track i.id) {
                <div class="row between"><span [class.fuerte]="i.kind === 'BASE'" [class.suave]="i.kind !== 'BASE'">{{ i.name }}</span><span class="num">{{ i.price | money }}</span></div>
              }
            </div>
            <div class="row between sep"><span class="fuerte">Total</span><span class="total" style="font-size: 40px">{{ o.total | money }}</span></div>
            <a class="btn chico" [routerLink]="['/ordenes', o.id]">Agregar adicional o ver la orden</a>
          </section>

          @if (o.status === 'READY') {
            <section class="card main col" style="gap: 18px">
              <div class="col">
                <p class="rotulo">Cómo paga</p>
                <div class="grid-sm">
                  @for (m of methods; track m) {
                    <button class="opcion" style="min-height: 64px; text-align: center" [attr.aria-pressed]="method() === m" (click)="method.set(m)">{{ names[m] }}</button>
                  }
                </div>
              </div>

              <div class="row">
                <label for="tip" class="grow" style="margin: 0; font-size: 15px; color: #fff; flex-basis: 200px">Propina para el equipo</label>
                <input id="tip" class="campo" style="width: 160px" dinero [(ngModel)]="tip" />
              </div>

              @if (method() === 'EFECTIVO') {
                <div class="col">
                  <p class="rotulo">Con cuánto paga</p>
                  <div class="grid-sm">
                    @for (b of bills(); track b) {
                      <button class="opcion num" style="text-align: center" [attr.aria-pressed]="cash() === b" (click)="cash.set(b)">{{ b === due() ? 'Exacto' : (b | money) }}</button>
                    }
                  </div>
                  <div>
                    <label for="cash">Otro valor</label>
                    <input id="cash" class="campo" dinero [(ngModel)]="cash" />
                  </div>
                  <div class="tile row between"><span class="fuerte">Devolver</span><span class="num fuerte" style="font-size: 32px">{{ change() | money }}</span></div>
                </div>
              } @else if (method()) {
                <div class="tile">
                  <label for="ref" style="color: #fff; font-weight: 700; font-size: 15px">Comprobante</label>
                  <input id="ref" class="campo" placeholder="Últimos 4 dígitos de la referencia" [(ngModel)]="reference" />
                  <p class="chico suave" style="margin-top: 8px">Verifica que el dinero llegó a la cuenta antes de entregar la moto.</p>
                </div>
              }

              <button class="btn primario grande" [disabled]="busy() || !method()" (click)="pay()">Confirmar pago y entregar</button>
              <p class="chico suave">Un cobro registrado no se borra. Si hay un error, se pide la anulación desde Caja.</p>
            </section>
          } @else {
            <section class="card main col">
              <p>Esta orden está en "{{ status[o.status] }}".</p>
              <p class="suave">{{ o.status === 'DELIVERED' ? 'Ya fue cobrada y entregada.' : 'Solo se cobra cuando la moto está lista para entregar.' }}</p>
              <a class="btn" [routerLink]="['/ordenes', o.id]">Ir a la orden</a>
            </section>
          }
        </div>
      } @else {
        <p class="vacio">Cargando…</p>
      }
    </main>
  `,
})
export class Cobro {
  private api = inject(Api);
  private toast = inject(Toast);
  private router = inject(Router);
  private id = inject(ActivatedRoute).snapshot.paramMap.get('id')!;

  protected methods = METHODS;
  protected names = METHOD_NAMES;
  protected status = STATUS_NAMES;
  protected order = signal<any | null>(null);
  protected method = signal('');
  protected tip = signal<number | null>(null);
  protected cash = signal<number | null>(null);
  protected reference = signal('');
  protected busy = signal(false);

  /** Total a recibir: servicio más propina. */
  protected due = computed(() => (this.order()?.total ?? 0) + (Number(this.tip()) || 0));
  protected bills = computed(() => {
    const due = this.due();
    const options = [due, ...[20000, 50000, 100000, 200000].filter((b) => b > due)];
    return [...new Set(options)].slice(0, 4);
  });
  protected change = computed(() => Math.max(0, (Number(this.cash()) || 0) - this.due()));

  constructor() {
    this.api.get('/orders/' + this.id).then((o) => this.order.set(o), this.toast.fail);
  }

  async pay() {
    const cash = this.cash() === null ? this.due() : Number(this.cash());
    if (this.method() === 'EFECTIVO' && cash < this.due()) return this.toast.show('El efectivo recibido no alcanza.', true);
    this.busy.set(true);
    try {
      const out = await this.api.post(`/orders/${this.id}/pay`, {
        method: this.method(),
        tip: Number(this.tip()) || 0,
        cashReceived: this.method() === 'EFECTIVO' ? cash : null,
        reference: this.reference(),
      });
      this.toast.show(out.change > 0 ? `Cobro registrado. Devuelve ${money(out.change)}.` : 'Cobro registrado. Moto entregada.');
      this.router.navigateByUrl('/ordenes');
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
}

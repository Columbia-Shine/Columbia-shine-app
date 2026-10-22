import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, bogotaDay, MoneyInput, MoneyPipe, Session, Toast, WhenPipe } from '../core';

const PURCHASE_METHODS: Record<string, string> = {
  CAJA: 'Efectivo de la caja', TRANSFERENCIA: 'Transferencia', NEQUI: 'Nequi', DAVIPLATA: 'Daviplata', TARJETA: 'Tarjeta', EFECTIVO: 'Efectivo por fuera de la caja',
};

/** Inventario de insumos: stock, compras, conteos y (para el propietario) el consumo del mes. */
@Component({
  selector: 'app-inventario',
  imports: [FormsModule, MoneyInput, MoneyPipe, WhenPipe],
  template: `
    <main class="page">
      <h1>Inventario</h1>
      <p class="suave">Cuenta lo que queda de cada insumo de vez en cuando (por ejemplo, cada lunes): la diferencia con el conteo anterior es lo que se gastó.</p>

      <section class="grid">
        @for (s of supplies(); track s.id) {
          <article class="card col" style="gap: 8px" [style.opacity]="s.active ? 1 : 0.55">
            <div class="row between">
              <h2>{{ s.name }}</h2>
              @if (!s.active) { <span class="etiqueta">Oculto</span> } @else if (s.low) { <span class="etiqueta amarilla">Comprar</span> }
            </div>
            <div class="row between"><span class="suave">Queda</span><span class="fuerte" style="font-size: 22px">{{ s.stock }} {{ s.unit }}</span></div>
            <div class="row between chico"><span class="suave">Mínimo</span><span>{{ s.min_stock }} {{ s.unit }}</span></div>
            @if (owner) { <div class="row between chico"><span class="suave">Costo por {{ unitLabel(s.unit) }}</span><span>{{ s.unit_cost | money }}</span></div> }
            <div class="chico suave">{{ s.last_count ? 'Último conteo ' + (s.last_count | cuando: 'completa') : 'Sin conteos todavía' }}</div>

            @if (s.active) {
              <div class="row">
                <button class="btn chico" [attr.aria-pressed]="open() === s.id + ':count'" (click)="toggle(s.id + ':count')">Contar</button>
                <button class="btn chico" [attr.aria-pressed]="open() === s.id + ':buy'" (click)="toggle(s.id + ':buy')">Registrar compra</button>
              </div>
            }
            @if (open() === s.id + ':count') {
              <div class="col" style="gap: 8px">
                <label [for]="'c-' + s.id">¿Cuánto queda ({{ s.unit }})?</label>
                <input [id]="'c-' + s.id" class="campo" type="number" inputmode="decimal" min="0" step="any" [(ngModel)]="countQty" />
                <button class="btn chico primario" [disabled]="busy()" (click)="count(s)">Guardar conteo</button>
              </div>
            }
            @if (open() === s.id + ':buy') {
              <div class="col" style="gap: 8px">
                <div class="row">
                  <div class="grow"><label [for]="'q-' + s.id">Cantidad ({{ s.unit }})</label><input [id]="'q-' + s.id" class="campo" type="number" inputmode="decimal" min="0" step="any" [(ngModel)]="buyQty" /></div>
                  <div class="grow"><label [for]="'v-' + s.id">Valor pagado</label><input [id]="'v-' + s.id" class="campo" dinero [(ngModel)]="buyCost" /></div>
                </div>
                <label [for]="'m-' + s.id">Cómo se pagó</label>
                <select [id]="'m-' + s.id" class="campo" [(ngModel)]="buyMethod">
                  @for (m of methodList; track m) { <option [value]="m">{{ methods[m] }}</option> }
                </select>
                <p class="chico suave">{{ buyMethod() === 'CAJA' ? 'Queda como gasto de Insumos en la caja del turno.' : 'Queda como gasto de Insumos del mes.' }}</p>
                <button class="btn chico primario" [disabled]="busy()" (click)="buy(s)">Guardar compra</button>
              </div>
            }
            @if (owner) {
              <div class="row chico">
                <label [for]="'min-' + s.id" style="margin: 0">Mínimo</label>
                <input [id]="'min-' + s.id" class="campo" style="width: 110px; min-height: 40px" type="number" min="0" step="any" [ngModel]="s.min_stock" (change)="setMin(s, $any($event.target).value)" />
                <button class="btn chico" (click)="toggleActive(s)">{{ s.active ? 'Ocultar' : 'Mostrar' }}</button>
              </div>
            }
          </article>
        } @empty {
          <p class="vacio">Todavía no hay insumos. {{ owner ? 'Créalos abajo.' : 'El propietario los crea.' }}</p>
        }
      </section>

      @if (owner) {
        @if (usage(); as u) {
          <section class="card col">
            <div class="row between">
              <h2>Consumo del mes</h2>
              <input class="campo" style="width: 180px" type="month" aria-label="Mes del consumo" [max]="thisMonth" [ngModel]="month()" (ngModelChange)="setMonth($event)" />
            </div>
            <div class="grid-sm">
              <div class="kpi"><div class="rotulo">Insumos gastados</div><div class="valor">{{ u.total | money }}</div></div>
              <div class="kpi"><div class="rotulo">Motos cobradas</div><div class="valor">{{ u.bikes }}</div></div>
              <div class="kpi"><div class="rotulo">Costo real por moto</div><div class="valor amarillo">{{ u.perBike | money }}</div></div>
            </div>
            <div class="tabla-caja">
              <table style="min-width: 480px">
                <thead><tr><th>Insumo</th><th class="der">Comprado</th><th class="der">Gastado</th><th class="der">Valor gastado</th></tr></thead>
                <tbody>
                  @for (r of u.rows; track r.name) {
                    <tr><td>{{ r.name }}</td><td class="der">{{ r.bought }} {{ r.unit }}</td><td class="der">{{ r.used }} {{ r.unit }}</td><td class="der fuerte">{{ r.cost | money }}</td></tr>
                  } @empty {
                    <tr><td colspan="4" class="suave">Sin compras ni conteos este mes.</td></tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="chico suave">"Gastado" sale de los conteos: si no cuentas, no se ve el consumo. Para un costo por moto confiable, cuenta al inicio y al final del mes.</p>
          </section>
        }

        <section class="card col">
          <h2>Nuevo insumo</h2>
          <div class="grid">
            <div><label for="n-nombre">Nombre</label><input id="n-nombre" class="campo" placeholder="Ej.: Shampoo pH neutro" [(ngModel)]="newName" /></div>
            <div>
              <label for="n-unidad">Unidad</label>
              <select id="n-unidad" class="campo" [(ngModel)]="newUnit">
                @for (u of units; track u) { <option [value]="u">{{ u }}</option> }
              </select>
            </div>
            <div><label for="n-min">Avisar cuando queden</label><input id="n-min" class="campo" type="number" min="0" step="any" [(ngModel)]="newMin" /></div>
          </div>
          <button class="btn" style="align-self: flex-start" [disabled]="busy()" (click)="create()">Crear insumo</button>
        </section>
      }
    </main>
  `,
})
export class Inventario {
  private api = inject(Api);
  private toast = inject(Toast);
  protected owner = inject(Session).is('OWNER');

  protected methods = PURCHASE_METHODS;
  protected methodList = Object.keys(PURCHASE_METHODS);
  protected units = ['ml', 'L', 'g', 'kg', 'unidades'];
  protected supplies = signal<any[]>([]);
  protected usage = signal<any | null>(null);
  protected thisMonth = bogotaDay().slice(0, 7);
  protected month = signal(this.thisMonth);
  protected open = signal('');
  protected busy = signal(false);
  protected countQty = signal<number | null>(null);
  protected buyQty = signal<number | null>(null);
  protected buyCost = signal<number | null>(null);
  protected buyMethod = signal('CAJA');
  protected newName = signal('');
  protected newUnit = signal('ml');
  protected newMin = signal<number | null>(null);

  constructor() {
    this.load();
  }

  unitLabel = (u: string) => (u === 'unidades' ? 'unidad' : u);

  private load() {
    this.api.get('/supplies').then((s) => this.supplies.set(s), this.toast.fail);
    if (this.owner) this.api.get('/supplies/usage?month=' + this.month()).then((u) => this.usage.set(u), this.toast.fail);
  }

  setMonth(m: string) {
    if (!m) return;
    this.month.set(m);
    this.load();
  }

  toggle(key: string) {
    this.open.set(this.open() === key ? '' : key);
    this.countQty.set(null);
    this.buyQty.set(null);
    this.buyCost.set(null);
  }

  private async run(action: () => Promise<unknown>, done: string) {
    this.busy.set(true);
    try {
      await action();
      this.toast.show(done);
      this.open.set('');
      this.load();
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  count(s: any) {
    if (this.countQty() === null) return this.toast.show('Escribe cuánto queda.', true);
    this.run(() => this.api.post(`/supplies/${s.id}/count`, { qty: this.countQty() }), 'Conteo guardado.');
  }

  buy(s: any) {
    this.run(() => this.api.post(`/supplies/${s.id}/purchase`, { qty: this.buyQty(), cost: this.buyCost(), method: this.buyMethod() }), 'Compra registrada.');
  }

  setMin(s: any, value: string) {
    this.run(() => this.api.patch('/supplies/' + s.id, { minStock: Number(value) }), 'Mínimo actualizado.');
  }

  toggleActive(s: any) {
    this.run(() => this.api.patch('/supplies/' + s.id, { active: !s.active }), s.active ? 'Insumo oculto.' : 'Insumo visible.');
  }

  create() {
    this.run(async () => {
      await this.api.post('/supplies', { name: this.newName(), unit: this.newUnit(), minStock: Number(this.newMin()) || 0 });
      this.newName.set('');
      this.newMin.set(null);
    }, 'Insumo creado.');
  }
}

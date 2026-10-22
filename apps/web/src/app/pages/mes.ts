import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, bogotaDay, dayLabel, EXPENSE_CATEGORIES, MoneyInput, MoneyPipe, Toast } from '../core';

const EXPENSE_METHODS: Record<string, string> = {
  TRANSFERENCIA: 'Transferencia', NEQUI: 'Nequi', DAVIPLATA: 'Daviplata', TARJETA: 'Tarjeta', EFECTIVO: 'Efectivo (por fuera de la caja)',
};

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Cierre del mes: ventas, gastos por categoría, nómina y lo que queda, comparado con el mes anterior. */
@Component({
  selector: 'app-mes',
  imports: [FormsModule, MoneyInput, MoneyPipe],
  template: `
    <main class="page">
      <div class="row between">
        <div>
          <p class="rotulo">Cierre del mes</p>
          <h1>{{ monthName(month()) }}</h1>
        </div>
        <div class="row no-imprimir">
          <label for="mes" style="margin: 0">Mes</label>
          <input id="mes" class="campo" style="width: 180px" type="month" [max]="thisMonth" [ngModel]="month()" (ngModelChange)="setMonth($event)" />
          <button class="btn chico" (click)="print()">Imprimir o PDF</button>
        </div>
      </div>

      @if (data(); as d) {
        @let c = d.current;
        @let p = d.previous;
        <section class="grid">
          <div class="kpi azul">
            <div class="rotulo">Ventas</div><div class="valor">{{ c.sales | money }}</div>
            <div class="nota">{{ delta(c.sales, p.sales) }} vs. {{ monthName(p.month) }} · descuentos {{ c.discounts | money }}</div>
          </div>
          <div class="kpi"><div class="rotulo">Motos</div><div class="valor">{{ c.bikes }}</div><div class="nota">{{ delta(c.bikes, p.bikes) }} · ticket {{ c.ticket | money }}</div></div>
          <div class="kpi"><div class="rotulo">Gastos</div><div class="valor">{{ c.expensesTotal | money }}</div><div class="nota">{{ delta(c.expensesTotal, p.expensesTotal) }}</div></div>
          <div class="kpi"><div class="rotulo">Nómina</div><div class="valor">{{ c.payroll | money }}</div><div class="nota">Comisiones {{ c.commission | money }} · ajustes {{ c.topups | money }}</div></div>
          <div class="kpi"><div class="rotulo">Te queda</div><div class="valor" style="white-space: nowrap" [class.amarillo]="c.profit >= 0">{{ c.profit | money }}</div><div class="nota">{{ delta(c.profit, p.profit) }} · ventas − gastos − nómina</div></div>
        </section>
        @if (isCurrent()) { <p class="chico suave">El mes va en curso: las cifras se completan al terminar el mes.</p> }

        <div class="split">
          <section class="card main col">
            <h2>Gastos por categoría</h2>
            @for (e of c.expenses; track e.category) {
              <div class="col" style="gap: 4px">
                <div class="row between"><span>{{ e.category }}</span><span class="num fuerte">{{ e.amount | money }}</span></div>
                <div class="barra"><div [style.width.%]="share(e.amount, c.expensesTotal)"></div></div>
              </div>
            } @empty {
              <p class="suave">Sin gastos registrados este mes.</p>
            }
            <p class="chico suave">Suma los gastos de la caja (con su categoría) y los pagados por fuera. La nómina va aparte.</p>
          </section>
          <section class="card side col">
            <h2>Comparado con {{ monthName(p.month) }}</h2>
            <table>
              <thead><tr><th></th><th class="der">Este mes</th><th class="der">Anterior</th></tr></thead>
              <tbody>
                <tr><td>Ventas</td><td class="der">{{ c.sales | money }}</td><td class="der">{{ p.sales | money }}</td></tr>
                <tr><td>Motos</td><td class="der">{{ c.bikes }}</td><td class="der">{{ p.bikes }}</td></tr>
                <tr><td>Gastos</td><td class="der">{{ c.expensesTotal | money }}</td><td class="der">{{ p.expensesTotal | money }}</td></tr>
                <tr><td>Nómina</td><td class="der">{{ c.payroll | money }}</td><td class="der">{{ p.payroll | money }}</td></tr>
                <tr><td class="fuerte">Te queda</td><td class="der fuerte">{{ c.profit | money }}</td><td class="der">{{ p.profit | money }}</td></tr>
              </tbody>
            </table>
          </section>
        </div>

        <div class="split">
          <section class="card main col">
            <h2>Servicios vendidos</h2>
            <table>
              <thead><tr><th>Servicio</th><th class="der">Motos</th><th class="der">Ventas</th></tr></thead>
              <tbody>
                @for (s of c.byService; track s.name) { <tr><td>{{ s.name }}</td><td class="der">{{ s.n }}</td><td class="der">{{ s.amount | money }}</td></tr> }
                @empty { <tr><td colspan="3" class="suave">Sin ventas.</td></tr> }
              </tbody>
            </table>
          </section>
          <section class="card side col">
            <h2>Por lavador</h2>
            <table>
              <thead><tr><th>Lavador</th><th class="der">Motos</th><th class="der">Comisión</th></tr></thead>
              <tbody>
                @for (w of c.byWasher; track w.name) { <tr><td>{{ w.name }}</td><td class="der">{{ w.n }}</td><td class="der">{{ w.commission | money }}</td></tr> }
                @empty { <tr><td colspan="3" class="suave">Sin lavados.</td></tr> }
              </tbody>
            </table>
          </section>
        </div>
      }

      <section class="card col no-imprimir">
        <h2>Gastos pagados por fuera de la caja</h2>
        <p class="chico suave">Arriendo por transferencia, servicios, compras con tarjeta… Los gastos pagados con plata de la caja se registran en Caja.</p>
        <div class="grid">
          <div><label for="g-dia">Día</label><input id="g-dia" class="campo" type="date" [max]="today" [(ngModel)]="eDay" /></div>
          <div>
            <label for="g-cat">Categoría</label>
            <select id="g-cat" class="campo" [(ngModel)]="eCategory">
              <option value="">Elegir…</option>
              @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
            </select>
          </div>
          <div><label for="g-val">Valor</label><input id="g-val" class="campo" dinero [(ngModel)]="eAmount" /></div>
          <div>
            <label for="g-medio">Cómo lo pagaste</label>
            <select id="g-medio" class="campo" [(ngModel)]="eMethod">
              @for (m of methodList; track m) { <option [value]="m">{{ methods[m] }}</option> }
            </select>
          </div>
          <div><label for="g-desc">Descripción</label><input id="g-desc" class="campo" placeholder="Ej.: arriendo de octubre" [(ngModel)]="eText" /></div>
        </div>
        <button class="btn primario" style="align-self: flex-start" [disabled]="busy()" (click)="addExpense()">Registrar gasto</button>
        <div class="tabla-caja">
          <table style="min-width: 560px">
            <thead><tr><th>Día</th><th>Categoría</th><th>Descripción</th><th>Medio</th><th class="der">Valor</th><th></th></tr></thead>
            <tbody>
              @for (e of expenses(); track e.id) {
                <tr>
                  <td>{{ label(e.day) }}</td><td>{{ e.category }}</td><td>{{ e.description }}</td><td>{{ methods[e.method] }}</td>
                  <td class="der fuerte">{{ e.amount | money }}</td>
                  <td class="der"><button class="btn chico" (click)="removeExpense(e)">Borrar</button></td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="suave">No hay gastos por fuera de la caja este mes.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </main>
  `,
  styles: `
    @media print { .no-imprimir { display: none !important; } }
  `,
})
export class Mes {
  private api = inject(Api);
  private toast = inject(Toast);

  protected today = bogotaDay();
  protected thisMonth = this.today.slice(0, 7);
  protected month = signal(this.thisMonth);
  protected data = signal<any | null>(null);
  protected expenses = signal<any[]>([]);
  protected busy = signal(false);
  protected categories = EXPENSE_CATEGORIES;
  protected methods = EXPENSE_METHODS;
  protected methodList = Object.keys(EXPENSE_METHODS);
  protected label = dayLabel;
  protected eDay = signal(this.today);
  protected eCategory = signal('');
  protected eAmount = signal<number | null>(null);
  protected eMethod = signal('TRANSFERENCIA');
  protected eText = signal('');

  protected isCurrent = computed(() => this.month() === this.thisMonth);

  constructor() {
    this.load();
  }

  monthName = (m: string): string =>
    m ? cap(new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(m + '-15T12:00:00Z'))) : '';

  /** Cambio frente al mes anterior: "+12%" o "−5%". */
  delta(now: number, before: number): string {
    if (!before) return now ? 'nuevo' : 'igual';
    const pct = Math.round(((now - before) / Math.abs(before)) * 100);
    return (pct > 0 ? '+' : pct < 0 ? '−' : '') + Math.abs(pct) + '%';
  }

  share = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

  setMonth(m: string) {
    if (!m) return;
    this.month.set(m);
    this.load();
  }

  private load() {
    const m = this.month();
    Promise.all([this.api.get('/month-close?month=' + m), this.api.get('/expenses?month=' + m)]).then(([d, e]) => {
      if (this.month() !== m) return;
      this.data.set(d);
      this.expenses.set(e);
    }, this.toast.fail);
  }

  private async run(action: () => Promise<unknown>, done: string) {
    this.busy.set(true);
    try {
      await action();
      this.toast.show(done);
      this.load();
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  addExpense() {
    this.run(async () => {
      await this.api.post('/expenses', { day: this.eDay(), category: this.eCategory(), amount: Number(this.eAmount()), method: this.eMethod(), description: this.eText() });
      this.eAmount.set(null);
      this.eText.set('');
      this.eCategory.set('');
    }, 'Gasto registrado.');
  }

  removeExpense(e: any) {
    this.run(() => this.api.del('/expenses/' + e.id), 'Gasto borrado.');
  }

  print() {
    window.print();
  }
}

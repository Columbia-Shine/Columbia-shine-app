import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, bogotaDay, dayLabel, METHOD_NAMES, MoneyInput, MoneyPipe, ROLE_NAMES, Toast, WhenPipe } from '../core';

/** Nómina diaria: lo que se le paga a cada persona por día, con los acuerdos de mínimo y su control. */
@Component({
  selector: 'app-nomina',
  imports: [FormsModule, MoneyInput, MoneyPipe, WhenPipe],
  template: `
    <main class="page">
      <div class="row between">
        <h1>Nómina</h1>
        <div class="row">
          <label for="dia" style="margin: 0">Día</label>
          <input id="dia" class="campo" style="width: 180px" type="date" [max]="today" [ngModel]="day()" (ngModelChange)="setDay($event)" />
        </div>
      </div>
      <p class="suave">{{ label(day()) }} · comisión {{ pct() }}% de lo cobrado en las motos que lavó cada persona. Las propinas se reparten por igual entre quienes lavaron ese día.</p>

      <section class="grid">
        @for (p of people(); track p.id) {
          <article class="card col" style="gap: 8px">
            <div class="row between">
              <h2>{{ p.name }}</h2>
              <span class="etiqueta" [class.azul]="p.role === 'ADMIN'">{{ roles[p.role] }}</span>
            </div>
            @if (p.paid; as d) {
              <div class="fila"><span class="suave">Lavados</span><span>{{ d.washes }} · cobrado {{ d.washed | money }}</span></div>
              <div class="fila"><span class="suave">Comisión</span><span class="num">{{ d.commission | money }}</span></div>
              <div class="fila"><span class="suave">Propinas</span><span class="num">{{ d.tips | money }}</span></div>
              @if (d.topup) { <div class="fila amarillo"><span>Ajuste del acuerdo</span><span class="num">{{ d.topup | money }}</span></div> }
              @if (d.loans) {
                <div class="fila sep"><span class="suave">Ganado</span><span class="num">{{ d.total | money }}</span></div>
                <div class="fila azul-claro"><span>Descontado de préstamos</span><span class="num">− {{ d.loans | money }}</span></div>
              }
              <div class="fila" [class.sep]="!d.loans"><span class="fuerte">Pagado</span><span class="total">{{ d.total - d.loans | money }}</span></div>
              @if (d.paid_cash || d.paid_other) {
                <p class="chico suave">
                  @if (d.paid_cash) { Efectivo {{ d.paid_cash | money }} {{ d.cash_movement_id ? "(retiro de la caja)" : "(por fuera de la caja)" }} }
                  @if (d.paid_cash && d.paid_other) { · }
                  @if (d.paid_other) { {{ methods[d.other_method] || 'Por fuera de la caja' }} {{ d.paid_other | money }} }
                </p>
              }
              <p class="chico suave">Registrado por {{ d.paid_by_name }}, {{ d.paid_at | cuando: 'completa' }}@if (d.note) { · {{ d.note }} }</p>
              <button class="btn chico" style="align-self: flex-start" (click)="undo(p)">Deshacer</button>
            } @else {
              <div class="fila"><span class="suave">Lavados</span><span>{{ p.washes }} · cobrado {{ p.washed | money }}</span></div>
              <div class="fila"><span class="suave">Comisión</span><span class="num">{{ p.commission | money }}</span></div>
              <div class="fila"><span class="suave">Propinas</span><span class="num">{{ p.tips | money }}</span></div>
              @if (p.guarantee; as g) {
                <div class="aviso chico">
                  Acuerdo: sin lavados, base {{ g.base_no_wash | money }}; con lavados, mínimo {{ g.min_commission | money }} de comisión@if (g.max_topup !== null) { (completas máximo {{ g.max_topup | money }}) }.
                  @if (p.washes > 0) {
                    <span class="fuerte">{{ p.topup ? 'Se completan ' + money(p.topup) + '.' : 'Ya pasó el mínimo: no hay ajuste.' }}</span>
                  }
                </div>
                @if (p.washes === 0) {
                  <label class="check"><input type="checkbox" [checked]="worked()[p.id]" (change)="toggleWorked(p.id)" /> <span>Vino a trabajar (se paga la base de {{ p.baseIfWorked | money }})</span></label>
                }
              }
              @if (topup(p)) { <div class="fila amarillo"><span>Ajuste del acuerdo</span><span class="num">{{ topup(p) | money }}</span></div> }
              @if (p.loanOwed) {
                <div class="fila sep"><span class="suave">Ganado</span><span class="num">{{ total(p) | money }}</span></div>
                <div class="aviso chico">
                  Debe {{ p.loanOwed | money }} en préstamos@if (p.loanDue) {, {{ p.loanDue | money }} para descontar de este pago}.
                </div>
                <div>
                  <label [for]="'pr-' + p.id">Descontar de préstamos</label>
                  <input [id]="'pr-' + p.id" class="campo" dinero [ngModel]="deductOf(p)" (ngModelChange)="setDeduct(p.id, $event)" />
                </div>
                @if (deductOf(p)) { <div class="fila azul-claro"><span>Descontado de préstamos</span><span class="num">− {{ deductOf(p) | money }}</span></div> }
              }
              <div class="fila" [class.sep]="!p.loanOwed"><span class="fuerte">Total a pagar</span><span class="total">{{ net(p) | money }}</span></div>
              @if (net(p)) {
                <div class="col" style="gap: 8px">
                  <p class="rotulo">¿Cómo le pagas?</p>
                  <div class="row" style="gap: 6px">
                    <button class="pastilla" [attr.aria-pressed]="modeOf(p.id) === 'EFECTIVO'" (click)="setMode(p.id, 'EFECTIVO')">Efectivo</button>
                    <button class="pastilla" [attr.aria-pressed]="modeOf(p.id) === 'OTRO'" (click)="setMode(p.id, 'OTRO')">{{ methods[methodOf(p.id)] }}</button>
                    <button class="pastilla" [attr.aria-pressed]="modeOf(p.id) === 'MIXTO'" (click)="setMode(p.id, 'MIXTO')">Efectivo + {{ methods[methodOf(p.id)] }}</button>
                  </div>
                  @if (modeOf(p.id) === 'MIXTO') {
                    <div>
                      <label [for]="'ef-' + p.id">¿Cuánto en efectivo?</label>
                      <input [id]="'ef-' + p.id" class="campo" dinero [ngModel]="cash()[p.id] ?? null" (ngModelChange)="setCash(p.id, $event)" />
                    </div>
                  }
                  @if (modeOf(p.id) !== 'EFECTIVO') {
                    <div class="row chico" style="gap: 8px">
                      <label [for]="'om-' + p.id" style="margin: 0">Por</label>
                      <select [id]="'om-' + p.id" class="campo" style="width: 170px; min-height: 40px" [ngModel]="methodOf(p.id)" (ngModelChange)="setMethod(p.id, $event)">
                        @for (m of outMethods; track m) { <option [value]="m">{{ methods[m] }}</option> }
                      </select>
                    </div>
                  }
                  <div class="tile chico">
                    @if (cashOf(p) > 0) { <div class="row between"><span>Efectivo</span><span class="fuerte">{{ cashOf(p) | money }}</span></div> }
                    @if (otherOf(p) > 0) { <div class="row between"><span>{{ methods[methodOf(p.id)] }}</span><span class="fuerte">{{ otherOf(p) | money }}</span></div> }
                    @if (cashOf(p) > 0) {
                      <div class="suave" style="margin-top: 4px">{{ shiftOpen() ? 'El efectivo sale de la caja: queda como retiro del turno.' : 'No hay turno de caja abierto: el efectivo queda como pagado por fuera de la caja.' }}</div>
                    }
                  </div>
                </div>
              }
              <button class="btn primario" [disabled]="busy() || !total(p)" (click)="pay(p)">{{ net(p) ? 'Registrar pago ' + money(net(p)) : 'Registrar: todo va al préstamo' }}</button>
            }
          </article>
        } @empty {
          <p class="vacio">Nadie lavó este día y no hay acuerdos vigentes.</p>
        }
      </section>

      <section class="card col">
        <h2>Préstamos</h2>
        <p class="chico suave">Plata que se le adelanta a alguien del equipo. "Del día" se descuenta solo en su pago de nómina; "lo paga después" queda debiendo y se descuenta o abona cuando acuerden.</p>
        @if (loans(); as l) {
          @if (l.owed.length) {
            <div class="grid-sm">
              @for (o of l.owed; track o.id) {
                <div class="kpi"><div class="rotulo">{{ o.name }} debe</div><div class="valor amarillo">{{ o.balance | money }}</div></div>
              }
            </div>
          }
          @for (x of l.open; track x.id) {
            <div class="tile col" style="gap: 6px">
              <div class="row between">
                <span class="fuerte">{{ x.name }} · {{ x.amount | money }}</span>
                <span class="etiqueta" [class.amarilla]="x.mode === 'DIA'">{{ x.mode === 'DIA' ? 'Del día' : 'Lo paga después' }}</span>
              </div>
              <div class="chico suave">
                {{ label(x.day) }} · {{ x.source === 'CAJA' ? 'salió de la caja' : 'por fuera de la caja' }} · registró {{ x.created_by_name }}@if (x.note) { · {{ x.note }} }
              </div>
              @if (x.payments.length) {
                <div class="chico suave">Abonos: @for (a of x.payments; track $index) { {{ a.amount | money }} ({{ a.method === 'NOMINA' ? 'nómina' : 'efectivo' }}){{ $last ? '' : ', ' }} }</div>
              }
              <div class="fila"><span>Debe</span><span class="fuerte amarillo">{{ x.balance | money }}</span></div>
              @if (paying() === x.id) {
                <div class="row">
                  <input class="campo" style="width: 150px" dinero placeholder="Abono" aria-label="Abono en efectivo" [(ngModel)]="payAmount" />
                  <button class="btn chico primario" [disabled]="busy()" (click)="payLoan(x)">Guardar abono</button>
                  <button class="btn chico" (click)="paying.set('')">Cancelar</button>
                </div>
                <p class="chico suave">{{ l.shiftOpen ? 'El abono entra a la caja del turno.' : 'No hay turno abierto: queda como recibido por fuera de la caja.' }}</p>
              } @else {
                <div class="row">
                  <button class="btn chico" (click)="paying.set(x.id); payAmount.set(x.balance)">Abono en efectivo</button>
                  @if (!x.payments.length) { <button class="btn chico" [disabled]="busy()" (click)="cancelLoan(x)">Anular</button> }
                </div>
              }
            </div>
          } @empty {
            <p class="chico suave">Nadie debe préstamos.</p>
          }
          @if (l.closed.length) {
            <details>
              <summary class="chico suave" style="cursor: pointer; min-height: 44px; display: flex; align-items: center">Préstamos pagados o anulados</summary>
              @for (x of l.closed; track x.id) {
                <div class="row between chico" style="padding: 6px 0">
                  <span>{{ label(x.day) }} · {{ x.name }} · {{ x.amount | money }}</span>
                  <span class="suave">{{ x.cancelled_at ? 'Anulado' : 'Pagado' }}</span>
                </div>
              }
            </details>
          }
        }

        <div class="sep col">
          <p class="rotulo">Nuevo préstamo</p>
          <div class="grid">
            <div>
              <label for="l-u">Persona</label>
              <select id="l-u" class="campo" [(ngModel)]="lUser">
                <option value="">Elegir…</option>
                @for (u of staff(); track u.id) { <option [value]="u.id">{{ u.name }}</option> }
              </select>
            </div>
            <div><label for="l-v">Valor</label><input id="l-v" class="campo" dinero [(ngModel)]="lAmount" /></div>
            <div><label for="l-n">Nota (opcional)</label><input id="l-n" class="campo" placeholder="Ej.: para el almuerzo" [(ngModel)]="lNote" /></div>
          </div>
          <p class="rotulo">¿Cómo lo paga?</p>
          <div class="row" style="gap: 6px">
            <button class="pastilla" [attr.aria-pressed]="lMode() === 'DIA'" (click)="lMode.set('DIA')">Se descuenta del pago de hoy</button>
            <button class="pastilla" [attr.aria-pressed]="lMode() === 'DESPUES'" (click)="lMode.set('DESPUES')">Lo paga después</button>
          </div>
          <p class="rotulo">¿De dónde sale la plata?</p>
          <div class="row" style="gap: 6px">
            <button class="pastilla" [attr.aria-pressed]="lSource() === 'CAJA'" [disabled]="!loans()?.shiftOpen" (click)="lSource.set('CAJA')">De la caja</button>
            <button class="pastilla" [attr.aria-pressed]="lSource() === 'FUERA'" (click)="lSource.set('FUERA')">Por fuera (Nequi, mi bolsillo)</button>
          </div>
          @if (!loans()?.shiftOpen) { <p class="chico suave">No hay turno de caja abierto: el préstamo queda por fuera de la caja.</p> }
          <button class="btn" style="align-self: flex-start" [disabled]="busy()" (click)="createLoan()">Registrar préstamo</button>
        </div>
      </section>

      <section class="card col">
        <h2>Acuerdos de mínimo</h2>
        @for (g of guarantees(); track g.id) {
          <div class="tile col" style="gap: 8px">
            <div class="row between">
              <div>
                <div class="fuerte">{{ g.name }} @if (g.current) { <span class="etiqueta amarilla">Vigente</span> } @else { <span class="etiqueta">Terminado</span> }</div>
                <div class="chico suave">{{ label(g.starts_on) }} al {{ label(g.ends_on) }} · base sin lavados {{ g.base_no_wash | money }} · mínimo {{ g.min_commission | money }}@if (g.max_topup !== null) { · completas máximo {{ g.max_topup | money }} }</div>
                @if (g.note) { <div class="chico suave">{{ g.note }}</div> }
              </div>
              @if (g.current) { <button class="btn chico" (click)="endToday(g)">Terminar hoy</button> }
            </div>
            <div class="grid-sm">
              <div class="kpi"><div class="rotulo">Días pagados</div><div class="valor">{{ g.totals.days }}</div></div>
              <div class="kpi"><div class="rotulo">Comisiones</div><div class="valor">{{ g.totals.commission | money }}</div></div>
              <div class="kpi"><div class="rotulo">Ajustes que pusiste</div><div class="valor amarillo">{{ g.totals.topup | money }}</div></div>
              <div class="kpi"><div class="rotulo">Total pagado</div><div class="valor">{{ g.totals.total | money }}</div></div>
            </div>
            @if (g.days.length) {
              <div class="tabla-caja">
                <table style="min-width: 520px">
                  <thead><tr><th>Día</th><th class="der">Lavados</th><th class="der">Comisión</th><th class="der">Propinas</th><th class="der">Ajuste</th><th class="der">Total</th></tr></thead>
                  <tbody>
                    @for (d of g.days; track d.id) {
                      <tr>
                        <td>{{ label(d.day) }}</td>
                        <td class="der">{{ d.washes }}</td>
                        <td class="der">{{ d.commission | money }}</td>
                        <td class="der">{{ d.tips | money }}</td>
                        <td class="der" [class.amarillo]="d.topup">{{ d.topup | money }}</td>
                        <td class="der fuerte">{{ d.total | money }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="chico suave">Todavía no hay días pagados en este acuerdo.</p>
            }
          </div>
        } @empty {
          <p class="chico suave">No hay acuerdos de mínimo.</p>
        }

        <div class="sep col">
          <p class="rotulo">Nuevo acuerdo</p>
          <div class="grid">
            <div>
              <label for="g-u">Persona</label>
              <select id="g-u" class="campo" [(ngModel)]="gUser">
                <option value="">Elegir…</option>
                @for (u of staff(); track u.id) { <option [value]="u.id">{{ u.name }}</option> }
              </select>
            </div>
            <div><label for="g-d">Desde</label><input id="g-d" class="campo" type="date" [(ngModel)]="gFrom" /></div>
            <div><label for="g-h">Hasta</label><input id="g-h" class="campo" type="date" [(ngModel)]="gTo" /></div>
            <div><label for="g-b">Base si no hay lavados</label><input id="g-b" class="campo" dinero [(ngModel)]="gBase" /></div>
            <div><label for="g-m">Mínimo de comisión</label><input id="g-m" class="campo" dinero [(ngModel)]="gMin" /></div>
            <div><label for="g-t">Máximo que completas (vacío = sin tope)</label><input id="g-t" class="campo" dinero [(ngModel)]="gCap" /></div>
            <div><label for="g-n">Nota</label><input id="g-n" class="campo" placeholder="Ej.: primer mes" [(ngModel)]="gNote" /></div>
          </div>
          <button class="btn" style="align-self: flex-start" [disabled]="busy()" (click)="createGuarantee()">Crear acuerdo</button>
        </div>
      </section>
    </main>
  `,
  styles: `
    .fila { display: flex; justify-content: space-between; gap: 12px; }
    .check { display: flex; align-items: center; gap: 12px; min-height: 44px; margin: 0; font-size: 15px; color: #fff; cursor: pointer; }
    .check input { width: 22px; height: 22px; accent-color: var(--amarillo); flex: 0 0 auto; }
    .azul-claro { color: var(--azul-claro); }
  `,
})
export class Nomina {
  private api = inject(Api);
  private toast = inject(Toast);

  protected roles: Record<string, string> = ROLE_NAMES;
  protected methods = METHOD_NAMES;
  protected outMethods = ['NEQUI', 'DAVIPLATA', 'TRANSFERENCIA'];
  /** Cuánto se paga en efectivo de la caja por persona (por defecto, todo) y por qué medio el resto */
  protected cash = signal<Record<string, number | null>>({});
  private method = signal<Record<string, string>>({});
  /** Cómo se le paga a cada persona: todo en efectivo, todo por Nequi (u otro medio) o mezclado */
  private mode = signal<Record<string, 'EFECTIVO' | 'OTRO' | 'MIXTO'>>({});
  protected shiftOpen = signal(false);
  modeOf = (id: string) => this.mode()[id] ?? 'EFECTIVO';
  setMode(id: string, m: 'EFECTIVO' | 'OTRO' | 'MIXTO') {
    this.mode.update((c) => ({ ...c, [id]: m }));
  }
  cashOf = (p: any): number => {
    const m = this.modeOf(p.id);
    if (m === 'EFECTIVO') return this.net(p);
    if (m === 'OTRO') return 0;
    return Math.min(Math.max(Number(this.cash()[p.id]) || 0, 0), this.net(p));
  };
  otherOf = (p: any): number => this.net(p) - this.cashOf(p);
  methodOf = (id: string): string => this.method()[id] ?? 'NEQUI';
  setCash(id: string, v: number | null) {
    this.cash.update((c) => ({ ...c, [id]: v ?? 0 }));
  }
  setMethod(id: string, m: string) {
    this.method.update((c) => ({ ...c, [id]: m }));
  }
  protected label = dayLabel;
  protected today = bogotaDay();
  protected day = signal(this.today);
  protected pct = signal(45);
  protected people = signal<any[]>([]);
  protected worked = signal<Record<string, boolean>>({});
  protected guarantees = signal<any[]>([]);
  protected staff = signal<any[]>([]);
  protected busy = signal(false);
  protected gUser = signal('');
  protected gFrom = signal(this.today);
  protected gTo = signal(bogotaDay(30));
  protected gBase = signal<number | null>(null);
  protected gMin = signal<number | null>(null);
  protected gCap = signal<number | null>(null);
  protected gNote = signal('');
  protected loans = signal<any | null>(null);
  protected lUser = signal('');
  protected lAmount = signal<number | null>(null);
  protected lNote = signal('');
  protected lMode = signal<'DIA' | 'DESPUES'>('DIA');
  protected lSource = signal<'CAJA' | 'FUERA'>('CAJA');
  protected paying = signal('');
  protected payAmount = signal<number | null>(null);
  /** Lo que se descuenta de préstamos en el pago de cada persona (por defecto, lo prestado "del día") */
  private deduct = signal<Record<string, number>>({});
  deductOf = (p: any): number => Math.min(this.deduct()[p.id] ?? p.loanDue ?? 0, p.loanOwed ?? 0, this.total(p));
  setDeduct(id: string, v: number | null) {
    this.deduct.update((d) => ({ ...d, [id]: Math.max(Number(v) || 0, 0) }));
  }
  net = (p: any): number => this.total(p) - this.deductOf(p);

  constructor() {
    this.load();
    this.loadGuarantees();
    this.loadLoans();
    this.api.get('/users').then((u: any[]) => this.staff.set(u.filter((x) => x.washes && x.active)), this.toast.fail);
  }

  protected money = (n: number) => '$' + new Intl.NumberFormat('es-CO').format(n);

  setDay(day: string) {
    if (!day) return;
    this.day.set(day);
    this.worked.set({});
    this.load();
  }

  private load() {
    const day = this.day();
    this.api.get('/payroll?day=' + day).then((d) => {
      if (this.day() !== day) return;
      this.pct.set(d.pct);
      this.shiftOpen.set(!!d.shiftOpen);
      this.people.set(d.people);
    }, this.toast.fail);
  }

  private loadLoans() {
    this.api.get('/loans').then((l) => {
      this.loans.set(l);
      if (!l.shiftOpen) this.lSource.set('FUERA');
    }, this.toast.fail);
  }

  private loadGuarantees() {
    this.api.get('/guarantees').then((g) => this.guarantees.set(g), this.toast.fail);
  }

  toggleWorked(id: string) {
    this.worked.update((w) => ({ ...w, [id]: !w[id] }));
  }

  /** Ajuste a mostrar: con lavados ya viene calculado; sin lavados, la base si se marcó que vino. */
  topup = (p: any): number => (p.washes > 0 ? p.topup : this.worked()[p.id] ? p.baseIfWorked : 0);
  total = (p: any): number => p.commission + p.tips + this.topup(p);

  private async run(action: () => Promise<unknown>, done: string) {
    this.busy.set(true);
    try {
      await action();
      this.toast.show(done);
      this.load();
      this.loadGuarantees();
      this.loadLoans();
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  pay(p: any) {
    const cash = this.cashOf(p);
    const other = this.otherOf(p);
    if (other > 0 && !this.methodOf(p.id)) return this.toast.show('Elige por qué medio le pagaste el resto.', true);
    this.run(
      () => this.api.post('/payroll/pay', { userId: p.id, day: this.day(), worked: !!this.worked()[p.id], cash, otherMethod: other > 0 ? this.methodOf(p.id) : null, loanDeduct: this.deductOf(p) }),
      cash > 0 && this.shiftOpen() ? `Pago de ${p.name} registrado. El retiro de ${this.money(cash)} quedó en la caja.` : `Pago de ${p.name} registrado.`,
    );
  }

  undo(p: any) {
    this.run(async () => {
      const out = await this.api.del('/payroll/' + p.paid.id);
      if (out?.cashKept) this.toast.show('Pago deshecho. El retiro de caja queda en el turno que ya se cerró.', true);
    }, 'Pago deshecho.');
  }

  createLoan() {
    if (!this.lUser()) return this.toast.show('Elige a quién le prestas.', true);
    if (!this.lAmount()) return this.toast.show('Escribe el valor del préstamo.', true);
    this.run(async () => {
      await this.api.post('/loans', { userId: this.lUser(), amount: Number(this.lAmount()), mode: this.lMode(), source: this.lSource(), note: this.lNote() });
      this.lUser.set('');
      this.lAmount.set(null);
      this.lNote.set('');
    }, this.lSource() === 'CAJA' ? 'Préstamo registrado. Quedó como retiro de la caja.' : 'Préstamo registrado.');
  }

  payLoan(x: any) {
    if (!this.payAmount()) return this.toast.show('Escribe el valor del abono.', true);
    this.run(async () => {
      await this.api.post(`/loans/${x.id}/payments`, { amount: Number(this.payAmount()) });
      this.paying.set('');
      this.payAmount.set(null);
    }, 'Abono registrado.');
  }

  cancelLoan(x: any) {
    this.run(async () => {
      const out = await this.api.del('/loans/' + x.id);
      if (out?.cashKept) this.toast.show('Préstamo anulado. El retiro queda en el turno que ya se cerró.', true);
    }, 'Préstamo anulado.');
  }

  endToday(g: any) {
    this.run(() => this.api.patch('/guarantees/' + g.id, { endsOn: this.today }), 'Acuerdo terminado.');
  }

  createGuarantee() {
    this.run(async () => {
      await this.api.post('/guarantees', {
        userId: this.gUser(), startsOn: this.gFrom(), endsOn: this.gTo(),
        baseNoWash: Number(this.gBase()) || 0, minCommission: Number(this.gMin()) || 0, maxTopup: this.gCap(), note: this.gNote(),
      });
      this.gUser.set('');
      this.gBase.set(null);
      this.gMin.set(null);
      this.gCap.set(null);
      this.gNote.set('');
    }, 'Acuerdo creado.');
  }
}

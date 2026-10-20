import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, bogotaDay, dayLabel, MoneyInput, MoneyPipe, ROLE_NAMES, Toast, WhenPipe } from '../core';

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
              <div class="fila sep"><span class="fuerte">Pagado</span><span class="total">{{ d.total | money }}</span></div>
              <p class="chico suave">Registrado por {{ d.paid_by_name }}, {{ d.paid_at | cuando: 'completa' }}@if (d.note) { · {{ d.note }} }</p>
              <button class="btn chico" style="align-self: flex-start" (click)="undo(p)">Deshacer</button>
            } @else {
              <div class="fila"><span class="suave">Lavados</span><span>{{ p.washes }} · cobrado {{ p.washed | money }}</span></div>
              <div class="fila"><span class="suave">Comisión</span><span class="num">{{ p.commission | money }}</span></div>
              <div class="fila"><span class="suave">Propinas</span><span class="num">{{ p.tips | money }}</span></div>
              @if (p.guarantee; as g) {
                <div class="aviso chico">
                  Acuerdo: sin lavados, base {{ g.base_no_wash | money }}; con lavados, mínimo {{ g.min_commission | money }} de comisión.
                  @if (p.washes > 0) {
                    <span class="fuerte">{{ p.topup ? 'Se completan ' + money(p.topup) + '.' : 'Ya pasó el mínimo: no hay ajuste.' }}</span>
                  }
                </div>
                @if (p.washes === 0) {
                  <label class="check"><input type="checkbox" [checked]="worked()[p.id]" (change)="toggleWorked(p.id)" /> <span>Vino a trabajar (se paga la base de {{ p.baseIfWorked | money }})</span></label>
                }
              }
              @if (topup(p)) { <div class="fila amarillo"><span>Ajuste del acuerdo</span><span class="num">{{ topup(p) | money }}</span></div> }
              <div class="fila sep"><span class="fuerte">Total a pagar</span><span class="total">{{ total(p) | money }}</span></div>
              <button class="btn primario" [disabled]="busy() || !total(p)" (click)="pay(p)">Registrar pago {{ total(p) | money }}</button>
            }
          </article>
        } @empty {
          <p class="vacio">Nadie lavó este día y no hay acuerdos vigentes.</p>
        }
      </section>

      <section class="card col">
        <h2>Acuerdos de mínimo</h2>
        @for (g of guarantees(); track g.id) {
          <div class="tile col" style="gap: 8px">
            <div class="row between">
              <div>
                <div class="fuerte">{{ g.name }} @if (g.current) { <span class="etiqueta amarilla">Vigente</span> } @else { <span class="etiqueta">Terminado</span> }</div>
                <div class="chico suave">{{ label(g.starts_on) }} al {{ label(g.ends_on) }} · base sin lavados {{ g.base_no_wash | money }} · mínimo {{ g.min_commission | money }}</div>
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
  `,
})
export class Nomina {
  private api = inject(Api);
  private toast = inject(Toast);

  protected roles: Record<string, string> = ROLE_NAMES;
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
  protected gNote = signal('');

  constructor() {
    this.load();
    this.loadGuarantees();
    this.api.get('/users').then((u: any[]) => this.staff.set(u.filter((x) => x.role !== 'OWNER' && x.active)), this.toast.fail);
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
      this.people.set(d.people);
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
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  pay(p: any) {
    this.run(() => this.api.post('/payroll/pay', { userId: p.id, day: this.day(), worked: !!this.worked()[p.id] }), `Pago de ${p.name} registrado.`);
  }

  undo(p: any) {
    this.run(() => this.api.del('/payroll/' + p.paid.id), 'Pago deshecho.');
  }

  endToday(g: any) {
    this.run(() => this.api.patch('/guarantees/' + g.id, { endsOn: this.today }), 'Acuerdo terminado.');
  }

  createGuarantee() {
    this.run(async () => {
      await this.api.post('/guarantees', {
        userId: this.gUser(), startsOn: this.gFrom(), endsOn: this.gTo(),
        baseNoWash: Number(this.gBase()) || 0, minCommission: Number(this.gMin()) || 0, note: this.gNote(),
      });
      this.gUser.set('');
      this.gBase.set(null);
      this.gMin.set(null);
      this.gNote.set('');
    }, 'Acuerdo creado.');
  }
}

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, METHOD_NAMES, MoneyPipe, Session, Toast, WhenPipe } from '../core';

@Component({
  selector: 'app-caja',
  imports: [FormsModule, NgTemplateOutlet, MoneyPipe, WhenPipe],
  template: `
    <main class="page">
      @if (loading()) {
        <p class="vacio">Cargando…</p>
      } @else if (closed(); as c) {
        <!-- Reporte diario que queda al cerrar el turno -->
        <h1>Turno cerrado</h1>
        <section class="grid">
          <div class="kpi azul"><div class="rotulo">Ventas</div><div class="valor">{{ c.sales | money }}</div><div class="nota">{{ c.bikes }} {{ c.bikes === 1 ? 'moto' : 'motos' }}</div></div>
          <div class="kpi"><div class="rotulo">Efectivo esperado</div><div class="valor">{{ c.shift.expected_cash | money }}</div></div>
          <div class="kpi"><div class="rotulo">Efectivo contado</div><div class="valor">{{ c.shift.counted_cash | money }}</div></div>
          <div class="kpi"><div class="rotulo">Diferencia</div><div class="valor" [class.amarillo]="c.shift.difference !== 0">{{ c.shift.difference | money }}</div><div class="nota">{{ c.shift.difference_note || 'Caja cuadrada' }}</div></div>
        </section>
        <section class="card col">
          <h2>Pago del día a lavadores</h2>
          <ng-container *ngTemplateOutlet="nomina; context: { $implicit: c }" />
        </section>
        <button class="btn" (click)="closed.set(null)">Abrir un turno nuevo</button>
      } @else if (!summary()) {
        <h1>Abrir caja</h1>
        <section class="card col narrow">
          <p class="suave">No hay turno abierto. Cuenta la base de efectivo con la que arranca la jornada.</p>
          <div>
            <label for="base">Base en efectivo</label>
            <input id="base" class="campo grande" type="number" inputmode="numeric" min="0" step="1000" [(ngModel)]="openingCash" />
          </div>
          <button class="btn primario grande" [disabled]="busy()" (click)="open()">Abrir turno</button>
        </section>
      } @else {
        @let s = summary();
        <div>
          <p class="rotulo">Turno de {{ s.shift.opened_by_name }} · abierto {{ s.shift.opened_at | cuando: 'completa' }}</p>
          <h1>Caja</h1>
        </div>

        <div class="split">
          <section class="card side col num" style="flex-basis: 400px">
            <h2>Efectivo</h2>
            <div class="row between"><span class="suave">Base al abrir</span><span>{{ s.shift.opening_cash | money }}</span></div>
            <div class="row between"><span class="suave">Ventas y propinas en efectivo</span><span>+ {{ s.cashSales | money }}</span></div>
            <div class="row between"><span class="suave">Entradas</span><span>+ {{ s.deposits | money }}</span></div>
            <div class="row between"><span class="suave">Gastos</span><span>− {{ s.expenses | money }}</span></div>
            <div class="row between"><span class="suave">Retiros</span><span>− {{ s.withdrawals | money }}</span></div>
            <div class="row between sep fuerte"><span>Debe haber</span><span>{{ s.expectedCash | money }}</span></div>

            <div class="sep col">
              <h2>Registrar movimiento</h2>
              <div class="row">
                @for (k of kinds; track k.id) {
                  <button class="pastilla" [attr.aria-pressed]="movKind() === k.id" (click)="movKind.set(k.id)">{{ k.label }}</button>
                }
              </div>
              <div class="row">
                <input class="campo" style="width: 140px" type="number" inputmode="numeric" min="0" step="1000" placeholder="Valor" aria-label="Valor" [(ngModel)]="movAmount" />
                <input class="campo grow" style="flex-basis: 160px" placeholder="¿En qué?" aria-label="Descripción" [(ngModel)]="movText" />
              </div>
              <button class="btn" [disabled]="busy()" (click)="addMovement()">Guardar movimiento</button>
              @for (m of s.movements; track m.id) {
                <div class="row between chico"><span>{{ m.created_at | cuando }} · {{ m.description }} <span class="suave">({{ m.user_name }})</span></span><span>{{ m.kind === 'ENTRADA' ? '+' : '−' }} {{ m.amount | money }}</span></div>
              }
            </div>
          </section>

          <div class="main col" style="gap: 20px">
            <section class="card col">
              <h2>Ventas del turno · {{ s.sales | money }} · {{ s.bikes }} {{ s.bikes === 1 ? 'moto' : 'motos' }}</h2>
              <div class="grid-sm num">
                @for (m of s.byMethod; track m.method) {
                  <div><div class="chico suave">{{ methods[m.method] }}</div><div class="fuerte" style="font-size: 20px">{{ m.amount | money }}</div></div>
                } @empty {
                  <p class="suave chico">Aún no hay cobros en este turno.</p>
                }
              </div>
            </section>

            <section class="card col">
              <h2>Cobros</h2>
              <p class="chico suave">
                {{ owner ? 'Como propietario puedes anular un cobro o resolver las solicitudes del administrador.' : 'Un cobro no se borra ni se edita. Si hubo un error, pide la anulación y el propietario decide.' }}
              </p>
              @for (p of payments(); track p.id) {
                <div class="tile col" style="gap: 8px">
                  <div class="row">
                    <div class="grow" style="flex-basis: 200px">
                      <div class="fuerte">{{ p.code }} · {{ p.plate }}</div>
                      <div class="chico suave">{{ p.service_name }} · {{ methods[p.method] }} · {{ p.created_at | cuando }} · cobró {{ p.created_by_name }}</div>
                    </div>
                    <span class="num fuerte" style="font-size: 18px" [style.text-decoration]="p.void_status === 'APPROVED' ? 'line-through' : 'none'">{{ p.amount | money }}</span>
                    @if (p.void_status === 'APPROVED') {
                      <span class="etiqueta">Anulado</span>
                    } @else if (p.void_status === 'REQUESTED') {
                      @if (owner) {
                        <button class="btn chico primario" [disabled]="busy()" (click)="resolve(p, true)">Aprobar anulación</button>
                        <button class="btn chico" [disabled]="busy()" (click)="resolve(p, false)">Rechazar</button>
                      } @else {
                        <span class="etiqueta amarilla">Esperando al propietario</span>
                      }
                    } @else {
                      <button class="btn chico" (click)="voiding.set(voiding() === p.id ? '' : p.id)">{{ owner ? 'Anular' : 'Pedir anulación' }}</button>
                    }
                  </div>
                  @if (p.void_reason) {
                    <div class="chico suave">Motivo: {{ p.void_reason }} @if (p.void_requested_by_name) { ({{ p.void_requested_by_name }}) } @if (p.void_status === 'REJECTED') { · solicitud rechazada }</div>
                  }
                  @if (voiding() === p.id) {
                    <div class="row">
                      <input class="campo grow" style="flex-basis: 200px" placeholder="Motivo de la anulación" aria-label="Motivo de la anulación" [(ngModel)]="voidReason" />
                      <button class="btn chico azul" [disabled]="busy()" (click)="requestVoid(p)">{{ owner ? 'Anular cobro' : 'Enviar al propietario' }}</button>
                    </div>
                  }
                </div>
              } @empty {
                <p class="vacio">Sin cobros todavía.</p>
              }
            </section>

            <section class="card col">
              <h2>Pago del día a lavadores</h2>
              <ng-container *ngTemplateOutlet="nomina; context: { $implicit: s }" />
            </section>
          </div>
        </div>

        <section class="card col">
          <h2>Cerrar turno</h2>
          @if (s.pendingOrders > 0) {
            <p class="aviso">{{ s.pendingOrders }} moto(s) siguen en el local y pasan al siguiente turno.</p>
          }
          <div class="row" style="align-items: flex-end">
            <div>
              <label for="contado">Efectivo contado</label>
              <input id="contado" class="campo grande" style="width: 240px" type="number" inputmode="numeric" min="0" step="1000" [(ngModel)]="counted" />
            </div>
            @if (counted() !== null) {
              <div class="aviso row between grow" [class.alerta]="difference() !== 0" style="flex-basis: 240px; min-height: 64px">
                <span class="fuerte">{{ difference() === 0 ? 'Caja cuadrada' : difference() < 0 ? 'Faltan' : 'Sobran' }}</span>
                <span class="num fuerte" style="font-size: 24px">{{ abs(difference()) | money }}</span>
              </div>
            }
          </div>
          @if (counted() !== null && difference() !== 0) {
            <div>
              <label for="nota">Explicación (obligatoria si hay diferencia). El propietario la ve en el cierre.</label>
              <textarea id="nota" class="campo" rows="2" [(ngModel)]="note"></textarea>
            </div>
          }
          <button class="btn primario grande" style="align-self: flex-start" [disabled]="busy() || counted() === null" (click)="close()">Cerrar turno</button>
        </section>
      }

      <ng-template #nomina let-s>
        <p class="chico suave">{{ s.commissionPct }}% de cada servicio que lavó la persona. Propinas ({{ s.tips | money }}) repartidas por igual entre quienes lavaron.</p>
        <div class="tabla-caja">
          <table style="min-width: 440px">
            <thead><tr><th>Lavador</th><th class="der">Motos</th><th class="der">Lavó</th><th class="der">{{ s.commissionPct }}%</th><th class="der">Propina</th><th class="der">A pagar</th></tr></thead>
            <tbody>
              @for (p of s.payroll; track p.id) {
                <tr><td class="fuerte">{{ p.name }}</td><td class="der">{{ p.n }}</td><td class="der">{{ p.washed | money }}</td><td class="der">{{ p.commission | money }}</td><td class="der">{{ p.tip | money }}</td><td class="der fuerte amarillo">{{ p.total | money }}</td></tr>
              } @empty {
                <tr><td colspan="6" class="suave">Aún no hay servicios cobrados en este turno.</td></tr>
              }
            </tbody>
          </table>
        </div>
        <p class="chico suave">Si pagas a los lavadores con efectivo de la caja antes de contar, regístralo como retiro.</p>
      </ng-template>
    </main>
  `,
})
export class Caja {
  private api = inject(Api);
  private toast = inject(Toast);
  protected owner = inject(Session).is('OWNER');

  protected methods = METHOD_NAMES;
  protected kinds = [
    { id: 'GASTO', label: 'Gasto' },
    { id: 'RETIRO', label: 'Retiro' },
    { id: 'ENTRADA', label: 'Entrada' },
  ];
  protected abs = Math.abs;
  protected loading = signal(true);
  protected busy = signal(false);
  protected summary = signal<any | null>(null);
  protected closed = signal<any | null>(null);
  protected payments = signal<any[]>([]);
  protected openingCash = signal<number | null>(null);
  protected movKind = signal('GASTO');
  protected movAmount = signal<number | null>(null);
  protected movText = signal('');
  protected counted = signal<number | null>(null);
  protected note = signal('');
  protected voiding = signal('');
  protected voidReason = signal('');
  protected difference = computed(() => (Number(this.counted()) || 0) - (this.summary()?.expectedCash ?? 0));

  constructor() {
    this.load();
  }

  private async load() {
    try {
      const [summary, payments] = await Promise.all([this.api.get('/shifts/current'), this.api.get('/payments')]);
      this.summary.set(summary);
      this.payments.set(payments);
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.loading.set(false);
    }
  }

  private async run(action: () => Promise<unknown>, done: string) {
    this.busy.set(true);
    try {
      await action();
      this.toast.show(done);
      await this.load();
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  open() {
    if (this.openingCash() === null) return this.toast.show('Escribe la base en efectivo (puede ser 0).', true);
    this.run(() => this.api.post('/shifts/open', { openingCash: Number(this.openingCash()) }), 'Turno abierto.');
  }

  addMovement() {
    this.run(async () => {
      await this.api.post('/shifts/movements', { kind: this.movKind(), amount: Number(this.movAmount()), description: this.movText() });
      this.movAmount.set(null);
      this.movText.set('');
    }, 'Movimiento guardado.');
  }

  requestVoid(p: any) {
    this.run(async () => {
      await this.api.post(`/payments/${p.id}/void`, { reason: this.voidReason() });
      this.voiding.set('');
      this.voidReason.set('');
    }, this.owner ? 'Cobro anulado. La moto volvió a "Lista para entregar".' : 'Solicitud enviada al propietario.');
  }

  resolve(p: any, approve: boolean) {
    this.run(() => this.api.post(`/payments/${p.id}/void-resolve`, { approve }), approve ? 'Cobro anulado. La moto volvió a "Lista para entregar".' : 'Solicitud rechazada.');
  }

  close() {
    this.run(async () => {
      const report = await this.api.post('/shifts/close', { countedCash: Number(this.counted()), note: this.note() });
      this.closed.set(report);
      this.counted.set(null);
      this.note.set('');
    }, 'Turno cerrado.');
  }
}

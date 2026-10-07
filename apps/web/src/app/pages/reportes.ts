import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, bogotaDay, dayLabel, METHOD_NAMES, MoneyPipe, Session, Toast, WhenPipe } from '../core';

@Component({
  selector: 'app-reportes',
  imports: [FormsModule, MoneyPipe, WhenPipe],
  template: `
    <main class="page">
      <div class="row between">
        <div>
          <p class="rotulo">{{ rangeLabel() }}</p>
          <h1>{{ owner ? 'Reportes' : 'Reporte de hoy' }}</h1>
        </div>
        <div class="row no-imprimir">
          @if (owner) {
            @for (r of ranges; track r.id) {
              <button class="pastilla" [attr.aria-pressed]="range() === r.id" (click)="pick(r.id)">{{ r.label }}</button>
            }
          }
          <button class="btn chico" (click)="exportCsv()">Exportar Excel (CSV)</button>
          <button class="btn chico" (click)="print()">Imprimir o PDF</button>
        </div>
      </div>

      @if (owner && range() === 'custom') {
        <div class="row no-imprimir" style="align-items: flex-end">
          <div><label for="desde">Desde</label><input id="desde" class="campo" type="date" [(ngModel)]="from" /></div>
          <div><label for="hasta">Hasta</label><input id="hasta" class="campo" type="date" [(ngModel)]="to" /></div>
          <button class="btn" (click)="load()">Consultar</button>
        </div>
      }

      @if (data(); as d) {
        <section class="grid">
          <div class="kpi azul"><div class="rotulo">Ventas</div><div class="valor">{{ d.sales | money }}</div><div class="nota">Propinas aparte: {{ d.tips | money }}</div></div>
          <div class="kpi"><div class="rotulo">Motos atendidas</div><div class="valor">{{ d.bikes }}</div><div class="nota">{{ d.newCustomers }} clientes nuevos</div></div>
          <div class="kpi"><div class="rotulo">Ticket promedio</div><div class="valor">{{ d.ticket | money }}</div><div class="nota">Adicionales: {{ extrasSales() | money }}</div></div>
          @if (owner) {
            <div class="kpi"><div class="rotulo">Contribución estimada</div><div class="valor amarillo">{{ d.sales - d.directCost | money }}</div><div class="nota">Antes de arriendo y gastos fijos</div></div>
          } @else {
            <div class="kpi"><div class="rotulo">Gastos de caja</div><div class="valor">{{ d.expenses | money }}</div></div>
          }
        </section>

        <div class="split">
          <section class="card main col">
            <h2>Ventas por día</h2>
            @if (d.byDay.length) {
              <div class="dias" [style.grid-template-columns]="'repeat(' + d.byDay.length + ', minmax(28px, 1fr))'">
                @for (x of d.byDay; track x.day) {
                  <div class="dia">
                    <span class="chico num suave">{{ thousands(x.sales) }}</span>
                    <div class="columna" [class.top]="x.sales === maxDay()" [style.height.px]="bar(x.sales)"></div>
                    <span class="chico">{{ shortDay(x.day) }}</span>
                  </div>
                }
              </div>
              <p class="chico suave">Valores en miles de pesos. En amarillo, el mejor día del periodo.</p>
            } @else {
              <p class="vacio">No hay ventas en este periodo.</p>
            }
          </section>

          <section class="card side col">
            <h2>Por lavador</h2>
            @for (w of d.byWasher; track w.name) {
              <div class="tile">
                <div class="row between"><span class="fuerte">{{ w.name }}</span><span class="num">{{ w.n }} motos · {{ w.washed | money }}</span></div>
                <div class="chico suave">
                  @if (w.avg_minutes !== null) { Promedio {{ w.avg_minutes }} min por moto · }
                  Comisión {{ w.commission | money }}
                </div>
              </div>
            } @empty {
              <p class="suave chico">Sin servicios cobrados.</p>
            }
            <h2 style="margin-top: 8px">Cómo pagaron</h2>
            <div class="grid-sm num">
              @for (m of d.byMethod; track m.method) {
                <div><div class="chico suave">{{ methods[m.method] }}</div><div class="fuerte">{{ m.amount | money }}</div></div>
              }
            </div>
          </section>
        </div>

        <section class="card col">
          <h2>{{ owner ? 'Rentabilidad por servicio' : 'Servicios vendidos' }}</h2>
          <div class="tabla-caja">
            <table style="min-width: 640px">
              <thead>
                <tr>
                  <th>Servicio</th><th class="der">Vendidos</th><th class="der">Ventas</th>
                  @if (owner) { <th class="der">Costo por moto</th><th class="der">Contribución</th> }
                  <th class="der">Tiempo real / objetivo</th>
                </tr>
              </thead>
              <tbody>
                @for (s of d.byService; track s.name) {
                  <tr>
                    <td [class.fuerte]="s.kind === 'BASE'">{{ s.name }}</td>
                    <td class="der">{{ s.n }}</td>
                    <td class="der">{{ s.sales | money }}</td>
                    @if (owner) {
                      <td class="der">{{ s.unit_cost === null ? '—' : (s.unit_cost | money) }}</td>
                      <td class="der fuerte amarillo">{{ s.contribution === null ? '—' : (s.contribution | money) }}</td>
                    }
                    <td class="der" [class.amarillo]="s.avg_minutes !== null && s.max_minutes && s.avg_minutes > s.max_minutes">
                      {{ s.kind === 'BASE' ? (s.avg_minutes ?? '—') + ' / ' + s.min_minutes + '–' + s.max_minutes + ' min' : '—' }}
                    </td>
                  </tr>
                } @empty {
                  <tr><td [attr.colspan]="owner ? 6 : 4" class="suave">Sin ventas en este periodo.</td></tr>
                }
              </tbody>
            </table>
          </div>
          @if (owner) {
            <p class="chico suave">El costo por moto sale del manual interno (producto y mano de obra de referencia) y solo existe para los servicios base; ajústalo cuando midas el consumo real. Los adicionales aún no tienen costo cargado.</p>
          }
        </section>

        <section class="grid">
          <div class="kpi"><div class="rotulo">Órdenes canceladas</div><div class="valor">{{ d.cancelled }}</div></div>
          <div class="kpi"><div class="rotulo">Cobros anulados</div><div class="valor">{{ d.voided }}</div></div>
          <div class="kpi"><div class="rotulo">Gastos de caja</div><div class="valor">{{ d.expenses | money }}</div></div>
          <div class="kpi"><div class="rotulo">Diferencias de caja</div><div class="valor" [class.amarillo]="d.cashDifferences > 0">{{ d.cashDifferences | money }}</div></div>
        </section>

        @if (owner) {
          <section class="card col no-imprimir">
            <h2>Últimos cierres de caja</h2>
            <div class="tabla-caja">
              <table style="min-width: 640px">
                <thead><tr><th>Abrió</th><th>Turno</th><th class="der">Ventas</th><th class="der">Esperado</th><th class="der">Contado</th><th class="der">Diferencia</th><th>Explicación</th></tr></thead>
                <tbody>
                  @for (s of shifts(); track s.id) {
                    <tr>
                      <td>{{ s.opened_by_name }}</td>
                      <td>{{ s.opened_at | cuando: 'completa' }} {{ s.closed_at ? '' : '(abierto)' }}</td>
                      <td class="der">{{ s.sales | money }}</td>
                      <td class="der">{{ s.closed_at ? (s.expected_cash | money) : '—' }}</td>
                      <td class="der">{{ s.closed_at ? (s.counted_cash | money) : '—' }}</td>
                      <td class="der fuerte" [class.amarillo]="s.difference">{{ s.closed_at ? (s.difference | money) : '—' }}</td>
                      <td class="chico">{{ s.difference_note || '' }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" class="suave">Aún no hay turnos.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
      } @else {
        <p class="vacio">Cargando…</p>
      }
    </main>
  `,
  styles: `
    .dias { display: grid; gap: 8px; align-items: end; overflow-x: auto; }
    .dia { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; height: 220px; text-transform: capitalize; }
    .columna { width: 100%; max-width: 56px; min-height: 2px; border-radius: 6px 6px 0 0; background: var(--azul); }
    .columna.top { background: var(--amarillo); }
    @media print { .no-imprimir { display: none !important; } }
  `,
})
export class Reportes {
  private api = inject(Api);
  private toast = inject(Toast);
  protected owner = inject(Session).is('OWNER');

  protected methods = METHOD_NAMES;
  protected ranges = [
    { id: 'today', label: 'Hoy' },
    { id: 'week', label: '7 días' },
    { id: 'month', label: 'Este mes' },
    { id: 'custom', label: 'Fechas' },
  ];
  protected range = signal(this.owner ? 'week' : 'today');
  protected from = signal(bogotaDay(-6));
  protected to = signal(bogotaDay());
  protected data = signal<any | null>(null);
  protected shifts = signal<any[]>([]);

  protected maxDay = computed(() => Math.max(1, ...(this.data()?.byDay ?? []).map((x: any) => Number(x.sales))));
  protected extrasSales = computed(() => (this.data()?.byService ?? []).filter((s: any) => s.kind === 'EXTRA').reduce((a: number, s: any) => a + s.sales, 0));
  protected rangeLabel = computed(() => {
    const d = this.data();
    if (!d) return '';
    return d.from === d.to ? dayLabel(d.from) : `${dayLabel(d.from)} – ${dayLabel(d.to)}`;
  });

  constructor() {
    this.pick(this.range());
    if (this.owner) this.api.get('/shifts/history').then((s) => this.shifts.set(s), this.toast.fail);
  }

  pick(id: string) {
    this.range.set(id);
    if (id === 'custom') return;
    const today = bogotaDay();
    this.to.set(today);
    this.from.set(id === 'today' ? today : id === 'week' ? bogotaDay(-6) : today.slice(0, 8) + '01');
    this.load();
  }

  load() {
    this.api.get(`/reports?from=${this.from()}&to=${this.to()}`).then((d) => this.data.set(d), this.toast.fail);
  }

  bar = (sales: number) => Math.round((Number(sales) / this.maxDay()) * 160);
  thousands = (sales: number) => Math.round(Number(sales) / 1000);
  shortDay = (day: string) => dayLabel(day).replace(/ de /g, ' ');
  print = () => window.print();

  /** Descarga el reporte como CSV, que Excel abre directamente. */
  exportCsv() {
    const d = this.data();
    if (!d) return;
    const rows: (string | number)[][] = [
      ['Columbia Shine', `Reporte ${d.from} a ${d.to}`],
      [],
      ['Ventas', d.sales], ['Motos', d.bikes], ['Ticket promedio', d.ticket], ['Propinas', d.tips],
      ['Canceladas', d.cancelled], ['Cobros anulados', d.voided], ['Gastos de caja', d.expenses],
      [],
      ['Día', 'Ventas', 'Motos'], ...d.byDay.map((x: any) => [x.day, x.sales, x.bikes]),
      [],
      ['Servicio', 'Vendidos', 'Ventas', ...(this.owner ? ['Costo por moto', 'Contribución'] : [])],
      ...d.byService.map((s: any) => [s.name, s.n, s.sales, ...(this.owner ? [s.unit_cost ?? '', s.contribution ?? ''] : [])]),
      [],
      ['Lavador', 'Motos', 'Lavó', 'Comisión'], ...d.byWasher.map((w: any) => [w.name, w.n, w.washed, w.commission]),
      [],
      ['Medio de pago', 'Valor'], ...d.byMethod.map((m: any) => [METHOD_NAMES[m.method], m.amount]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `columbia-shine-${d.from}_${d.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, METHOD_NAMES, MoneyPipe, Session, Toast, WhenPipe } from '../core';

type Alert = { tag: string; tone: string; title: string; detail: string; action: string; link: string };

@Component({
  selector: 'app-inicio',
  imports: [RouterLink, MoneyPipe, WhenPipe],
  template: `
    <main class="page">
      <div class="row between">
        <div>
          <p class="rotulo">{{ hoy }}</p>
          <h1>Así va el día</h1>
        </div>
        <a class="btn primario grande" routerLink="/recepcion">+ Recibir moto</a>
      </div>

      @if (data(); as d) {
        @if (!d.shift) {
          <div class="aviso alerta row between">
            <span>No hay turno abierto. Sin turno no se puede cobrar.</span>
            <a class="btn chico" style="border-color: #111; color: #111" routerLink="/caja">Abrir caja</a>
          </div>
        }
        <section class="grid">
          <div class="kpi azul">
            <div class="rotulo">Ventas de hoy</div>
            <div class="valor">{{ d.sales | money }}</div>
            <div class="nota">{{ d.bikes }} {{ d.bikes === 1 ? 'moto' : 'motos' }} · ticket promedio {{ d.ticket | money }}</div>
          </div>
          <div class="kpi">
            <div class="rotulo">En proceso ahora</div>
            <div class="valor">{{ count('WAITING') + count('WASHING') + count('REVIEW') }}</div>
            <div class="nota">{{ count('WAITING') }} en espera · {{ count('WASHING') }} en lavado · {{ count('REVIEW') }} en revisión</div>
          </div>
          <div class="kpi">
            <div class="rotulo">Listas para entregar</div>
            <div class="valor amarillo">{{ count('READY') }}</div>
            <div class="nota">Pendientes de cobro: {{ readyAmount() | money }}</div>
          </div>
          <div class="kpi">
            <div class="rotulo">Reservas de hoy</div>
            <div class="valor">{{ d.bookings.length }}</div>
            <div class="nota">
              @if (d.bookings[0]; as b) { Sigue: {{ b.starts_at | cuando }} · {{ b.customer_name }} } @else { Sin reservas pendientes }
            </div>
          </div>
        </section>

        <div class="split">
          <section class="card main col">
            <div class="row between">
              <h2>Necesita tu atención</h2>
              <a routerLink="/ordenes">Ver todas las órdenes</a>
            </div>
            @for (a of alerts(); track a.title + a.tag) {
              <div class="tile row">
                <span class="etiqueta" [class]="a.tone">{{ a.tag }}</span>
                <div class="grow" style="flex-basis: 240px">
                  <div class="fuerte">{{ a.title }}</div>
                  <div class="chico suave">{{ a.detail }}</div>
                </div>
                <a class="btn chico" [routerLink]="a.link">{{ a.action }}</a>
              </div>
            } @empty {
              <p class="vacio">Todo al día: no hay motos demoradas, sin asignar ni pendientes de cobro.</p>
            }
          </section>

          <div class="side col" style="gap: 20px">
            <section class="card col">
              <h2>Servicios vendidos hoy</h2>
              @for (s of d.byService; track s.name) {
                <div>
                  <div class="row between chico"><span>{{ s.name }}</span><span class="num suave">{{ s.n }} · {{ s.amount | money }}</span></div>
                  <div class="barra" style="margin-top: 6px"><div [style.width.%]="pct(s.amount, d.sales)"></div></div>
                </div>
              } @empty {
                <p class="suave chico">Aún no hay ventas hoy.</p>
              }
            </section>
            <section class="card col">
              <h2>Cómo pagaron</h2>
              <div class="grid-sm">
                @for (m of d.byMethod; track m.method) {
                  <div><div class="chico suave">{{ methods[m.method] }}</div><div class="fuerte num" style="font-size: 20px">{{ m.amount | money }}</div></div>
                } @empty {
                  <p class="suave chico">Sin cobros todavía.</p>
                }
              </div>
            </section>
          </div>
        </div>

        <section class="card col">
          <h2>Equipo</h2>
          <div class="grid">
            @for (t of d.team; track t.id) {
              <div class="tile">
                <div class="row between"><span class="fuerte">{{ t.name }}</span><span class="chico suave">{{ t.done }} motos hoy</span></div>
                <div class="chico suave">{{ t.in_progress > 0 ? t.in_progress + ' en proceso' : 'Libre' }}</div>
              </div>
            } @empty {
              <p class="suave chico">Crea los usuarios del equipo en Ajustes.</p>
            }
          </div>
        </section>
      } @else {
        <p class="vacio">Cargando…</p>
      }
    </main>
  `,
})
export class Inicio implements OnDestroy {
  private api = inject(Api);
  private toast = inject(Toast);
  private session = inject(Session);

  protected methods = METHOD_NAMES;
  protected hoy = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' }).format(new Date());
  protected data = signal<any | null>(null);
  private timer = setInterval(() => this.load(), 30000);

  protected alerts = computed<Alert[]>(() => {
    const d = this.data();
    if (!d) return [];
    const out: Alert[] = [];
    if (d.voidRequests > 0 && this.session.is('OWNER')) {
      out.push({ tag: 'Anulación', tone: 'amarilla', title: `${d.voidRequests} cobro(s) esperan tu decisión`, detail: 'El administrador pidió anular un cobro.', action: 'Revisar', link: '/caja' });
    }
    for (const o of d.active) {
      const bike = `${o.code} · ${o.plate} · ${o.service_name}`;
      if (o.status === 'WASHING' && o.max_minutes && o.minutes > o.max_minutes) {
        out.push({ tag: 'Demorada', tone: 'amarilla', title: bike, detail: `Lleva ${o.minutes} min en lavado. El tiempo objetivo es ${o.max_minutes} min.`, action: 'Ver orden', link: '/ordenes/' + o.id });
      } else if (o.status === 'READY') {
        out.push({ tag: 'Por cobrar', tone: 'aqua', title: bike, detail: `Lista hace ${o.ready_minutes ?? 0} min. Total ${this.fmt(o.total)}.`, action: 'Cobrar', link: '/cobro/' + o.id });
      } else if (o.status === 'REVIEW') {
        out.push({ tag: 'Por revisar', tone: 'azul', title: bike, detail: 'El lavador terminó. Falta la revisión de entrega.', action: 'Revisar', link: '/ordenes/' + o.id });
      } else if (o.status === 'WAITING' && !o.washer_id) {
        out.push({ tag: 'Sin asignar', tone: '', title: bike, detail: `En espera hace ${o.minutes} min.`, action: 'Asignar', link: '/ordenes/' + o.id });
      }
    }
    return out;
  });

  protected readyAmount = computed(() => (this.data()?.active ?? []).filter((o: any) => o.status === 'READY').reduce((a: number, o: any) => a + o.total, 0));

  constructor() {
    this.load();
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  private fmt = new MoneyPipe().transform;
  count = (status: string) => (this.data()?.active ?? []).filter((o: any) => o.status === status).length;
  pct = (part: number, total: number) => (total > 0 ? Math.min(100, Math.round((part / total) * 100)) : 0);

  load() {
    this.api.get('/dashboard').then((d) => this.data.set(d), this.toast.fail);
  }
}

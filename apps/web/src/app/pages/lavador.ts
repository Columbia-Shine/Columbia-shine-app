import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { Api, minutesSince, Session, Toast } from '../core';

/** Pantalla del lavador: solo sus motos, sin cifras del negocio. */
@Component({
  selector: 'app-lavador',
  template: `
    <main class="page narrow">
      <div>
        <h1>Hola, {{ firstName }}</h1>
        <p class="suave" style="margin-top: 4px">{{ done().length }} motos terminadas hoy</p>
      </div>

      @if (current(); as o) {
        <section class="actual col">
          <div class="row between">
            <span class="rotulo" style="color: #dbeafe">En lavado · {{ o.code }}</span>
            <span class="num fuerte" style="font-size: 24px" [class.amarillo]="late()">{{ minutes() }} min</span>
          </div>
          <div class="placa" style="font-size: 30px">{{ o.plate }}</div>
          <div style="color: #dbeafe">{{ o.brand }} {{ o.model }} @if (o.color) { · {{ o.color }} }</div>
          <div class="servicio">{{ title(o) }}</div>
          <div class="chico" style="color: #dbeafe">Tiempo objetivo {{ o.min_minutes }}–{{ o.max_minutes }} min</div>
        </section>

        @if (o.notes) {
          <div class="aviso"><div class="fuerte amarillo">Ojo al recibir</div><div>{{ o.notes }}</div></div>
        }

        <section class="col" style="gap: 6px">
          <p class="rotulo">Pasos del servicio</p>
          @for (s of o.steps; track $index) {
            <label class="paso"><input type="checkbox" [checked]="steps()[$index]" (change)="toggle($index)" /> <span>{{ s }}</span></label>
          }
        </section>

        <button class="btn primario grande" [disabled]="busy()" (click)="move(o, 'REVIEW')">Terminé: pasar a revisión</button>
        <p class="chico suave">Si el cliente pide algo adicional o encuentras un daño, avísale al administrador antes de hacerlo.</p>
      } @else {
        <p class="vacio">No tienes una moto en lavado.</p>
      }

      @if (waiting().length) {
        <section class="col">
          <p class="rotulo">{{ current() ? 'Siguen' : 'Te asignaron' }}</p>
          @for (o of waiting(); track o.id) {
            <div class="tile row">
              <div class="grow">
                <div class="placa" style="font-size: 20px">{{ o.plate }}</div>
                <div class="chico suave">{{ o.brand }} {{ o.model }} · {{ title(o) }}</div>
              </div>
              <button class="btn" [class.primario]="!current()" [disabled]="busy() || !!current()" (click)="move(o, 'WASHING')">Iniciar</button>
            </div>
          }
          @if (current()) { <p class="chico suave">Termina la moto actual para iniciar la siguiente.</p> }
        </section>
      }
    </main>
  `,
  styles: `
    .actual { padding: 16px; border-radius: 16px; background: var(--azul-oscuro); gap: 8px; }
    .servicio { font-size: 18px; font-weight: 800; font-style: italic; color: var(--amarillo); }
    .paso { display: flex; align-items: center; gap: 12px; min-height: 48px; margin: 0; padding: 0 12px; border: 1px solid var(--gris-medio); border-radius: 10px; font-size: 15px; font-weight: 600; color: #fff; cursor: pointer; }
    .paso input { width: 22px; height: 22px; accent-color: var(--amarillo); flex: 0 0 auto; }
  `,
})
export class Lavador implements OnDestroy {
  private api = inject(Api);
  private toast = inject(Toast);
  protected firstName = inject(Session).user()?.name.split(' ')[0] ?? '';

  protected orders = signal<any[]>([]);
  protected busy = signal(false);
  protected steps = signal<boolean[]>([]);
  private tick = signal(0);
  private timer = setInterval(() => {
    this.tick.update((t) => t + 1);
    this.load();
  }, 20000);

  protected current = computed(() => this.orders().find((o) => o.status === 'WASHING'));
  protected waiting = computed(() => this.orders().filter((o) => o.status === 'WAITING'));
  protected done = computed(() => this.orders().filter((o) => ['REVIEW', 'READY', 'DELIVERED'].includes(o.status)));
  protected minutes = computed(() => {
    this.tick();
    return minutesSince(this.current()?.started_at);
  });
  protected late = computed(() => !!this.current()?.max_minutes && this.minutes() > this.current().max_minutes);

  constructor() {
    this.load();
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  title = (o: any): string => o.items.map((i: any) => i.name).join(' + ');

  toggle(i: number) {
    this.steps.update((s) => {
      const next = [...s];
      next[i] = !next[i];
      return next;
    });
  }

  private load() {
    this.api.get('/orders?scope=mine').then((o) => this.orders.set(o), this.toast.fail);
  }

  async move(o: any, status: string) {
    this.busy.set(true);
    try {
      await this.api.post(`/orders/${o.id}/status`, { status });
      this.steps.set([]);
      this.toast.show(status === 'WASHING' ? 'Lavado iniciado.' : 'Listo: pasó a revisión.');
      this.load();
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
}

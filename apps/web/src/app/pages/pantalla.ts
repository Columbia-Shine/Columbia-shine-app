import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, minutesSince } from '../core';

const COLUMNS = [
  { status: 'WAITING', label: 'En espera' },
  { status: 'WASHING', label: 'En lavado' },
  { status: 'READY', label: 'Listas para recoger' },
];

/** Tablero para una pantalla del local: estado de las motos, se actualiza solo y sin menú. */
@Component({
  selector: 'app-pantalla',
  imports: [RouterLink],
  template: `
    <main class="tablero-pantalla">
      <header class="encabezado">
        <img src="logo.png" alt="Columbia Shine" width="88" height="85" />
        <div class="grow">
          <div class="marca">Columbia Shine</div>
          <div class="lema">Pasión por tu máquina.</div>
        </div>
        <div class="hora">{{ clock() }}</div>
        <a class="salir" routerLink="/inicio" aria-label="Salir de la pantalla">Salir</a>
      </header>
      <div class="columnas">
        @for (c of columns(); track c.status) {
          <section class="columna" [class.lista]="c.status === 'READY'">
            <h2>{{ c.label }} <span>{{ c.orders.length }}</span></h2>
            @for (o of c.orders; track o.id) {
              <article class="moto">
                <div class="placa">{{ o.plate }}</div>
                <div class="servicio">{{ o.service_name }}</div>
                <div class="tiempo">{{ time(o) }}</div>
              </article>
            } @empty {
              <p class="vacia">—</p>
            }
          </section>
        }
      </div>
    </main>
  `,
  styles: `
    .tablero-pantalla { min-height: 100vh; padding: 24px; display: flex; flex-direction: column; gap: 20px; }
    .encabezado { display: flex; align-items: center; gap: 20px; }
    .marca { font-size: 34px; font-weight: 800; font-style: italic; }
    .lema { color: var(--amarillo); font-size: 18px; font-weight: 600; }
    .hora { font-size: 40px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .salir { color: var(--texto-tenue); font-size: 14px; padding: 12px; }
    .columnas { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
    .columna { background: var(--panel); border-radius: var(--radio); padding: 20px; display: flex; flex-direction: column; gap: 14px; }
    .columna.lista { border: 3px solid var(--amarillo); }
    h2 { margin: 0; font-size: 26px; display: flex; justify-content: space-between; }
    h2 span { color: var(--amarillo); }
    .moto { background: var(--gris-oscuro); border-radius: 12px; padding: 16px 18px; }
    .lista .moto { background: var(--azul-oscuro); }
    .placa { font-size: 42px; font-weight: 800; letter-spacing: 0.06em; }
    .servicio { font-size: 20px; font-style: italic; font-weight: 700; color: var(--azul-claro); }
    .lista .servicio { color: #fff; }
    .tiempo { font-size: 18px; color: var(--texto-suave); margin-top: 4px; }
    .vacia { color: var(--texto-tenue); font-size: 28px; text-align: center; margin-top: 20px; }
    @media (max-width: 900px) { .columnas { grid-template-columns: 1fr; } .placa { font-size: 32px; } }
  `,
})
export class Pantalla implements OnDestroy {
  private api = inject(Api);
  protected orders = signal<any[]>([]);
  private now = signal(Date.now());
  private timer = setInterval(() => this.load(), 15000);
  private tick = setInterval(() => this.now.set(Date.now()), 30000);

  protected clock = computed(() =>
    new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' }).format(this.now()),
  );
  protected columns = computed(() =>
    COLUMNS.map((c) => ({ ...c, orders: this.orders().filter((o) => o.status === c.status || (c.status === 'READY' && o.status === 'REVIEW')) })),
  );

  constructor() {
    this.load();
  }

  ngOnDestroy() {
    clearInterval(this.timer);
    clearInterval(this.tick);
  }

  time(o: any): string {
    this.now();
    if (o.status === 'WASHING') return `Lavando hace ${minutesSince(o.started_at)} min`;
    if (o.status === 'READY' || o.status === 'REVIEW') return `Lista hace ${minutesSince(o.ready_at)} min`;
    return `Llegó hace ${minutesSince(o.created_at)} min`;
  }

  private load() {
    // Sin avisos de error en pantalla: si falla la red, se reintenta en el próximo ciclo
    this.api.get('/orders?scope=active').then((o) => this.orders.set(o), () => undefined);
  }
}

import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, minutesSince, MoneyPipe, STATUS_NAMES, Toast, WhenPipe } from '../core';

@Component({
  selector: 'app-clientes',
  imports: [FormsModule, RouterLink, MoneyPipe, WhenPipe],
  template: `
    <main class="page">
      <div class="row between">
        <h1>Clientes</h1>
        <input class="campo" style="max-width: 340px" type="search" placeholder="Buscar por nombre, celular o placa" aria-label="Buscar cliente"
          [ngModel]="term()" (ngModelChange)="search($event)" />
      </div>
      <section class="card tabla-caja">
        <table style="min-width: 640px">
          <thead><tr><th>Cliente</th><th>Celular</th><th>Motos</th><th class="der">Visitas</th><th class="der">Total gastado</th><th class="der">Última visita</th></tr></thead>
          <tbody>
            @for (c of customers(); track c.id) {
              <tr>
                <td><a class="fuerte" [routerLink]="['/clientes', c.id]">{{ c.name }}</a></td>
                <td>{{ c.phone || '—' }}</td>
                <td>{{ c.plates || '—' }}</td>
                <td class="der">{{ c.visits }}</td>
                <td class="der">{{ c.spent | money }}</td>
                <td class="der">{{ c.last_visit ? (c.last_visit | cuando: 'fecha') : '—' }}</td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="suave">{{ term() ? 'Ningún cliente coincide con la búsqueda.' : 'Los clientes aparecen aquí cuando recibes su primera moto.' }}</td></tr>
            }
          </tbody>
        </table>
      </section>
    </main>
  `,
})
export class Clientes {
  private api = inject(Api);
  private toast = inject(Toast);
  protected term = signal('');
  protected customers = signal<any[]>([]);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.load();
  }

  search(value: string) {
    this.term.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 300);
  }

  private load() {
    const term = this.term();
    this.api.get('/customers?q=' + encodeURIComponent(term)).then((c) => {
      if (this.term() === term) this.customers.set(c);
    }, this.toast.fail);
  }
}

@Component({
  selector: 'app-cliente',
  imports: [FormsModule, RouterLink, MoneyPipe, WhenPipe],
  template: `
    <main class="page">
      @if (data(); as d) {
        <div class="row between">
          <div>
            <p class="rotulo">Cliente desde {{ d.customer.created_at | cuando: 'fecha' }}</p>
            <h1>{{ d.customer.name }}</h1>
            <p class="suave" style="margin-top: 6px">{{ d.customer.phone || 'Sin celular' }} @if (d.customer.email) { · {{ d.customer.email }} }</p>
          </div>
          <div class="row">
            @if (d.customer.phone) { <a class="btn" [href]="'https://wa.me/57' + d.customer.phone" target="_blank" rel="noopener">Escribir por WhatsApp</a> }
            <button class="btn" (click)="editing.set(!editing())">{{ editing() ? 'Cerrar' : 'Editar datos' }}</button>
          </div>
        </div>

        @if (editing()) {
          <section class="card col">
            <div class="grid">
              <div><label for="n">Nombre</label><input id="n" class="campo" [(ngModel)]="name" /></div>
              <div><label for="p">Celular</label><input id="p" class="campo" type="tel" [(ngModel)]="phone" /></div>
              <div><label for="e">Correo</label><input id="e" class="campo" type="email" [(ngModel)]="email" /></div>
              <div><label for="d">Documento</label><input id="d" class="campo" [(ngModel)]="document" /></div>
            </div>
            <button class="btn primario" style="align-self: flex-start" (click)="save()">Guardar</button>
          </section>
        }

        <section class="grid">
          <div class="kpi"><div class="rotulo">Visitas</div><div class="valor">{{ stats().visits }}</div></div>
          <div class="kpi"><div class="rotulo">Total gastado</div><div class="valor">{{ stats().spent | money }}</div></div>
          <div class="kpi"><div class="rotulo">Ticket promedio</div><div class="valor">{{ stats().ticket | money }}</div></div>
          <div class="kpi"><div class="rotulo">Última visita</div><div class="valor">{{ stats().lastDays === null ? '—' : 'Hace ' + stats().lastDays + ' días' }}</div></div>
        </section>

        <div class="split">
          <section class="card side col">
            <h2>Motos</h2>
            @for (b of d.bikes; track b.id) {
              <div class="tile">
                <div class="placa">{{ b.plate }}</div>
                <div class="chico suave">{{ b.brand }} {{ b.model }} @if (b.color) { · {{ b.color }} } @if (b.year) { · {{ b.year }} }</div>
                <a class="btn chico primario" style="margin-top: 10px" routerLink="/recepcion" [queryParams]="{ placa: b.plate }">Recibir esta moto</a>
              </div>
            } @empty {
              <p class="suave chico">Aún no tiene motos registradas.</p>
            }
          </section>

          <section class="card main col">
            <h2>Historial de servicios</h2>
            <div class="tabla-caja">
              <table style="min-width: 560px">
                <thead><tr><th>Fecha</th><th>Orden</th><th>Placa</th><th>Servicio</th><th>Lavador</th><th>Estado</th><th class="der">Valor</th></tr></thead>
                <tbody>
                  @for (o of d.orders; track o.id) {
                    <tr>
                      <td>{{ o.created_at | cuando: 'fecha' }}</td>
                      <td><a [routerLink]="['/ordenes', o.id]">{{ o.code }}</a></td>
                      <td>{{ o.plate }}</td>
                      <td class="fuerte">{{ describe(o) }}</td>
                      <td>{{ o.washer_name || '—' }}</td>
                      <td>{{ names[o.status] }}</td>
                      <td class="der fuerte">{{ o.total | money }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" class="suave">Sin servicios todavía.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>
      } @else {
        <p class="vacio">Cargando…</p>
      }
    </main>
  `,
})
export class Cliente {
  private api = inject(Api);
  private toast = inject(Toast);
  private id = inject(ActivatedRoute).snapshot.paramMap.get('id')!;

  protected names = STATUS_NAMES;
  protected data = signal<any | null>(null);
  protected editing = signal(false);
  protected name = signal('');
  protected phone = signal('');
  protected email = signal('');
  protected document = signal('');

  protected stats = computed(() => {
    const done = (this.data()?.orders ?? []).filter((o: any) => o.status === 'DELIVERED');
    const spent = done.reduce((a: number, o: any) => a + o.total, 0);
    const last = done[0]?.delivered_at;
    return {
      visits: done.length,
      spent,
      ticket: done.length ? Math.round(spent / done.length) : 0,
      lastDays: last ? Math.floor(minutesSince(last) / 1440) : null,
    };
  });

  constructor() {
    this.load();
  }

  describe = (o: any): string => o.items.map((i: any) => i.name).join(' + ');

  private load() {
    this.api.get('/customers/' + this.id).then((d) => {
      this.data.set(d);
      this.name.set(d.customer.name);
      this.phone.set(d.customer.phone ?? '');
      this.email.set(d.customer.email ?? '');
      this.document.set(d.customer.document ?? '');
    }, this.toast.fail);
  }

  async save() {
    try {
      await this.api.patch('/customers/' + this.id, { name: this.name(), phone: this.phone(), email: this.email(), document: this.document() });
      this.toast.show('Datos guardados.');
      this.editing.set(false);
      this.load();
    } catch (e) {
      this.toast.fail(e);
    }
  }
}

import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, minutesSince, MoneyPipe, STATUS_NAMES, Toast, WhenPipe } from '../core';

@Component({
  selector: 'app-clientes',
  imports: [FormsModule, RouterLink, MoneyPipe, WhenPipe],
  template: `
    <main class="page">
      <div class="row between">
        <h1>Clientes</h1>
        <div class="row">
          <button class="pastilla" [attr.aria-pressed]="tab() === 'todos'" (click)="tab.set('todos')">Todos</button>
          <button class="pastilla" [attr.aria-pressed]="tab() === 'recuperar'" (click)="openRecover()">Para recuperar</button>
        </div>
      </div>

      @if (tab() === 'recuperar') {
        <section class="card col">
          <div class="row between">
            <p class="suave">Clientes que no vuelven hace más de</p>
            <div class="row">
              @for (d of [30, 45, 60, 90]; track d) {
                <button class="pastilla" [attr.aria-pressed]="days() === d" (click)="setDays(d)">{{ d }} días</button>
              }
            </div>
          </div>
          <div>
            <label for="msg">Mensaje (usa {{ '{' }}nombre{{ '}' }} y {{ '{' }}placa{{ '}' }})</label>
            <textarea id="msg" class="campo" rows="3" [(ngModel)]="message"></textarea>
          </div>
          <p class="chico suave">No aparecen quienes ya tienen una reserva o una moto en el local.</p>
        </section>
        <section class="card tabla-caja">
          <table style="min-width: 640px">
            <thead><tr><th>Cliente</th><th>Motos</th><th>Último servicio</th><th class="der">Visitas</th><th class="der">Sin venir</th><th></th></tr></thead>
            <tbody>
              @for (c of inactive(); track c.id) {
                <tr>
                  <td><a class="fuerte" [routerLink]="['/clientes', c.id]">{{ c.name }}</a><div class="chico suave">{{ c.phone }}</div></td>
                  <td>{{ c.plates || '—' }}</td>
                  <td>{{ c.last_service }}<div class="chico suave">{{ c.last_visit | cuando: 'fecha' }}</div></td>
                  <td class="der">{{ c.visits }}</td>
                  <td class="der fuerte">{{ c.days_since }} días</td>
                  <td class="der">
                    <a class="btn chico primario" [href]="invite(c)" target="_blank" rel="noopener" (click)="contacted(c)">Escribir por WhatsApp</a>
                    @if (c.last_contacted_at) { <div class="chico suave">Le escribiste {{ c.last_contacted_at | cuando: 'fecha' }}</div> }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="suave">Nadie lleva más de {{ days() }} días sin venir. Bien hecho.</td></tr>
              }
            </tbody>
          </table>
        </section>
      } @else {
      <div class="row">
        <input class="campo" style="max-width: 340px" type="search" placeholder="Buscar por nombre, celular o placa" aria-label="Buscar cliente"
          [ngModel]="term()" (ngModelChange)="search($event)" />
      </div>
      <section class="card tabla-caja">
        <table style="min-width: 640px">
          <thead><tr><th>Cliente</th><th>Celular</th><th>Motos</th><th class="der">Visitas</th><th class="der">Total gastado</th><th class="der">Última visita</th></tr></thead>
          <tbody>
            @for (c of customers(); track c.id) {
              <tr>
                <td>
                  <a class="fuerte" [routerLink]="['/clientes', c.id]">{{ c.name }}</a>
                  @if (c.pending) { <span class="etiqueta amarilla" style="margin-left: 8px">Datos pendientes</span> }
                </td>
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
      }
    </main>
  `,
})
export class Clientes {
  private api = inject(Api);
  private toast = inject(Toast);
  protected term = signal('');
  protected customers = signal<any[]>([]);
  private timer: ReturnType<typeof setTimeout> | undefined;

  // ---- Para recuperar ----
  protected tab = signal<'todos' | 'recuperar'>('todos');
  protected days = signal(30);
  protected inactive = signal<any[]>([]);
  protected message = signal('Hola {nombre}, te extrañamos en Columbia Shine. Tu moto {placa} merece brillar de nuevo: esta semana tienes 10% de descuento en cualquier lavado. ¿Te agendamos? Pasión por tu máquina.');

  openRecover() {
    this.tab.set('recuperar');
    this.loadInactive();
  }

  setDays(d: number) {
    this.days.set(d);
    this.loadInactive();
  }

  private loadInactive() {
    this.api.get('/customers/inactive?days=' + this.days()).then((c) => this.inactive.set(c), this.toast.fail);
  }

  invite(c: any): string {
    const text = this.message()
      .replaceAll('{nombre}', String(c.name).split(' ')[0])
      .replaceAll('{placa}', String(c.plates ?? '').split(',')[0].trim());
    return `https://wa.me/57${c.phone}?text=${encodeURIComponent(text)}`;
  }

  contacted(c: any) {
    this.api.post(`/customers/${c.id}/contacted`, {}).then(
      () => this.inactive.update((list) => list.map((x) => (x.id === c.id ? { ...x, last_contacted_at: new Date().toISOString() } : x))),
      this.toast.fail,
    );
  }

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

        @if (d.customer.pending) {
          <div class="aviso"><span class="fuerte amarillo">Cliente de afán.</span> Se recibió solo con la placa. Completa su nombre y celular; si el celular ya es de otro cliente, se unen y la placa queda con su historial.</div>
        }

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
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private id = '';

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
    // La misma pantalla se reutiliza al pasar de un cliente a otro (por ejemplo, al unirlos)
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      this.id = p.get('id')!;
      this.data.set(null);
      this.editing.set(false);
      this.load();
    });
  }

  describe = (o: any): string => o.items.map((i: any) => i.name).join(' + ');

  private load() {
    this.api.get('/customers/' + this.id).then((d) => {
      this.data.set(d);
      if (d.customer.pending) this.editing.set(true);
      this.name.set(d.customer.pending ? '' : d.customer.name);
      this.phone.set(d.customer.phone ?? '');
      this.email.set(d.customer.email ?? '');
      this.document.set(d.customer.document ?? '');
    }, this.toast.fail);
  }

  async save() {
    try {
      const out = await this.api.patch('/customers/' + this.id, { name: this.name(), phone: this.phone(), email: this.email(), document: this.document() });
      this.editing.set(false);
      if (out.id !== this.id) {
        // Se unió a un cliente que ya existía con ese celular
        this.toast.show('Ese celular ya era de un cliente: se unieron y la placa quedó en su historial.');
        this.router.navigateByUrl('/clientes/' + out.id);
        return;
      }
      this.toast.show('Datos guardados.');
      this.load();
    } catch (e) {
      this.toast.fail(e);
    }
  }
}

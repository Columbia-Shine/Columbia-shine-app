import { Component, computed, Directive, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, bogotaDay, dayLabel, MoneyPipe, Session, Toast, WhenPipe } from '../core';

const DAYS_AHEAD = 10;

/** Hora '14:00' → '2:00 p. m.' */
const hourLabel = (time: string): string => {
  const h = Number(time.split(':')[0]);
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'a. m.' : 'p. m.'}`;
};

/** Lo común a las dos pantallas de agenda: servicios, días, horarios libres y reservas. */
@Directive()
abstract class Booker {
  protected api = inject(Api);
  protected toast = inject(Toast);

  protected hourLabel = hourLabel;
  protected days = Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const id = bogotaDay(i);
    const [wd, rest] = dayLabel(id).split(', ');
    return { id, wd: i === 0 ? 'Hoy' : wd, rest: rest ?? '' };
  });
  protected services = signal<any[]>([]);
  protected bookings = signal<any[]>([]);
  protected slots = signal<any[]>([]);
  protected day = signal(this.days[0].id);
  protected time = signal('');
  protected serviceId = signal('');
  protected busy = signal(false);

  protected service = computed(() => this.services().find((s) => s.id === this.serviceId()));

  constructor() {
    this.api.get('/services').then((s: any[]) => {
      const bases = s.filter((x) => x.kind === 'BASE');
      this.services.set(bases);
      this.serviceId.set((bases.find((x) => x.recommended) ?? bases[0])?.id ?? '');
    }, this.toast.fail);
    this.loadSlots();
    this.loadBookings();
  }

  pickDay(id: string) {
    this.day.set(id);
    this.time.set('');
    this.loadSlots();
  }

  protected loadSlots() {
    const day = this.day();
    this.api.get('/bookings/slots?date=' + day).then((s) => {
      if (this.day() === day) this.slots.set(s);
    }, this.toast.fail);
  }

  protected loadBookings() {
    this.api.get('/bookings').then((b) => this.bookings.set(b), this.toast.fail);
  }

  protected async book(extra: Record<string, unknown>, done: string) {
    if (!this.time()) return this.toast.show('Elige una hora disponible.', true);
    this.busy.set(true);
    try {
      await this.api.post('/bookings', { date: this.day(), time: this.time(), serviceId: this.serviceId(), ...extra });
      this.toast.show(done);
      this.time.set('');
      this.loadSlots();
      this.loadBookings();
      return true;
    } catch (e) {
      this.toast.fail(e);
      this.loadSlots();
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async cancel(id: string) {
    try {
      await this.api.post(`/bookings/${id}/cancel`);
      this.toast.show('Reserva cancelada.');
      this.loadSlots();
      this.loadBookings();
    } catch (e) {
      this.toast.fail(e);
    }
  }
}

const PICKER_STYLES = `
  .dias { display: grid; grid-auto-flow: column; grid-auto-columns: 72px; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
  .dia { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60px; padding: 4px; text-align: center; text-transform: capitalize; }
  .horas { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
  .hora { text-align: center; min-height: 48px; padding: 4px; }
`;

/** El cliente registrado agenda su lavado desde el celular. */
@Component({
  selector: 'app-agendar',
  imports: [FormsModule, MoneyPipe, WhenPipe],
  template: `
    <main class="page narrow">
      <div>
        <h1>Agenda tu lavado</h1>
        <p class="suave" style="margin-top: 4px">Hola, {{ firstName }}. Elige día y hora; pagas en el local.</p>
      </div>

      @for (b of bookings(); track b.id) {
        <div class="aviso row">
          <div class="grow">
            <div class="fuerte">Tu reserva: {{ b.starts_at | cuando: 'completa' }}</div>
            <div class="chico suave">{{ b.service_name }} · {{ b.price | money }} @if (b.plate) { · {{ b.plate }} }</div>
          </div>
          <button class="btn chico" (click)="cancel(b.id)">Cancelar</button>
        </div>
      }

      <section class="card col">
        <div>
          <label for="moto" class="rotulo">Tu moto</label>
          <select id="moto" class="campo" [(ngModel)]="bikeId">
            @for (b of bikes(); track b.id) { <option [value]="b.id">{{ b.plate }} · {{ b.brand }} {{ b.model }}</option> }
            <option value="">Agregar una moto</option>
          </select>
        </div>
        @if (!bikeId()) {
          <div class="col">
            <div><label for="np">Placa</label><input id="np" class="campo" style="text-transform: uppercase" maxlength="8" [(ngModel)]="newPlate" /></div>
            <div class="row">
              <div class="grow"><label for="nb">Marca</label><input id="nb" class="campo" [(ngModel)]="newBrand" /></div>
              <div class="grow"><label for="nm">Modelo</label><input id="nm" class="campo" [(ngModel)]="newModel" /></div>
            </div>
            <button class="btn" (click)="addBike()">Guardar moto</button>
          </div>
        }
        <div>
          <label for="serv" class="rotulo">Servicio</label>
          <select id="serv" class="campo" [(ngModel)]="serviceId">
            @for (s of services(); track s.id) { <option [value]="s.id">{{ s.name }} · {{ s.price | money }} · {{ s.min_minutes }}–{{ s.max_minutes }} min</option> }
          </select>
        </div>

        <p class="rotulo">Día</p>
        <div class="dias">
          @for (d of days; track d.id) {
            <button class="opcion dia" [attr.aria-pressed]="day() === d.id" (click)="pickDay(d.id)">
              <span class="chico suave">{{ d.wd }}</span><span>{{ d.rest }}</span>
            </button>
          }
        </div>

        <p class="rotulo">Hora</p>
        <div class="horas">
          @for (s of slots(); track s.time) {
            <button class="opcion hora num" [attr.aria-pressed]="time() === s.time" [disabled]="s.free === 0" (click)="time.set(s.time)">{{ hourLabel(s.time) }}</button>
          }
        </div>
        <p class="chico suave">Las horas tachadas ya están ocupadas o ya pasaron.</p>

        @if (service(); as s) {
          @if (time()) { <div class="aviso">{{ s.name }} a las {{ hourLabel(time()) }}. Total {{ s.price | money }}.</div> }
        }
        <button class="btn primario grande" [disabled]="busy()" (click)="confirm()">Confirmar reserva</button>
        <p class="chico suave" style="text-align: center">Pagas en el local al recoger tu moto.</p>
      </section>
    </main>
  `,
  styles: PICKER_STYLES,
})
export class Agendar extends Booker {
  private session = inject(Session);
  protected firstName = this.session.user()?.name.split(' ')[0] ?? '';
  protected bikes = signal<any[]>([]);
  protected bikeId = signal('');
  protected newPlate = signal('');
  protected newBrand = signal('');
  protected newModel = signal('');

  constructor() {
    super();
    this.api.get('/my/bikes').then((b: any[]) => {
      this.bikes.set(b);
      this.bikeId.set(b[0]?.id ?? '');
    }, this.toast.fail);
  }

  async addBike() {
    try {
      const bike = await this.api.post('/my/bikes', { plate: this.newPlate(), brand: this.newBrand(), model: this.newModel() });
      this.bikes.update((b) => [...b, bike]);
      this.bikeId.set(bike.id);
      this.newPlate.set('');
      this.newBrand.set('');
      this.newModel.set('');
    } catch (e) {
      this.toast.fail(e);
    }
  }

  confirm() {
    if (!this.bikeId()) return this.toast.show('Guarda primero tu moto.', true);
    this.book({ bikeId: this.bikeId() }, 'Reserva confirmada. Te esperamos.');
  }
}

/** Agenda del local: el administrador ve las reservas y agenda por teléfono o WhatsApp. */
@Component({
  selector: 'app-agenda',
  imports: [FormsModule, RouterLink, MoneyPipe, WhenPipe],
  template: `
    <main class="page">
      <h1>Agenda</h1>
      <div class="split">
        <section class="card main col">
          <h2>Próximas reservas</h2>
          @for (g of groups(); track g.day) {
            <p class="rotulo" style="margin-top: 6px">{{ g.label }}</p>
            @for (b of g.items; track b.id) {
              <div class="tile row">
                <span class="num fuerte" style="font-size: 18px; min-width: 96px">{{ b.starts_at | cuando }}</span>
                <div class="grow" style="flex-basis: 220px">
                  <div class="fuerte">{{ b.customer_name }} @if (b.plate) { · {{ b.plate }} }</div>
                  <div class="chico suave">{{ b.service_name }} · {{ b.price | money }} @if (b.phone) { · {{ b.phone }} }</div>
                </div>
                <a class="btn chico primario" routerLink="/recepcion"
                  [queryParams]="{ reserva: b.id, placa: b.plate, servicio: b.service_id, nombre: b.customer_name, celular: b.phone }">Llegó: recibir</a>
                <button class="btn chico" (click)="cancel(b.id)">Cancelar</button>
              </div>
            }
          } @empty {
            <p class="vacio">No hay reservas próximas. Los clientes agendan desde su celular en la dirección de la app, sección "Agenda tu lavado".</p>
          }
        </section>

        <section class="card side col" style="flex-basis: 400px">
          <h2>Agendar a un cliente</h2>
          <div class="row">
            <div class="grow" style="flex-basis: 160px"><label for="cn">Nombre</label><input id="cn" class="campo" [(ngModel)]="customerName" autocomplete="off" /></div>
            <div class="grow" style="flex-basis: 140px"><label for="cp">Celular</label><input id="cp" class="campo" type="tel" inputmode="numeric" [(ngModel)]="customerPhone" autocomplete="off" /></div>
          </div>
          <div>
            <label for="serv">Servicio</label>
            <select id="serv" class="campo" [(ngModel)]="serviceId">
              @for (s of services(); track s.id) { <option [value]="s.id">{{ s.name }} · {{ s.price | money }}</option> }
            </select>
          </div>
          <p class="rotulo">Día</p>
          <div class="dias">
            @for (d of days; track d.id) {
              <button class="opcion dia" [attr.aria-pressed]="day() === d.id" (click)="pickDay(d.id)">
                <span class="chico suave">{{ d.wd }}</span><span>{{ d.rest }}</span>
              </button>
            }
          </div>
          <p class="rotulo">Hora</p>
          <div class="horas">
            @for (s of slots(); track s.time) {
              <button class="opcion hora num" [attr.aria-pressed]="time() === s.time" [disabled]="s.free === 0" (click)="time.set(s.time)">
                {{ hourLabel(s.time) }}<br /><span class="chico suave">{{ s.free }} cupo(s)</span>
              </button>
            }
          </div>
          <button class="btn primario" [disabled]="busy()" (click)="confirm()">Agendar</button>
        </section>
      </div>
    </main>
  `,
  styles: PICKER_STYLES,
})
export class Agenda extends Booker {
  protected customerName = signal('');
  protected customerPhone = signal('');

  protected groups = computed(() => {
    const out: { day: string; label: string; items: any[] }[] = [];
    for (const b of this.bookings()) {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(b.starts_at));
      let g = out.find((x) => x.day === day);
      if (!g) out.push((g = { day, label: day === bogotaDay() ? 'Hoy' : dayLabel(day), items: [] }));
      g.items.push(b);
    }
    return out;
  });

  async confirm() {
    const ok = await this.book({ customerName: this.customerName(), customerPhone: this.customerPhone() }, 'Reserva creada.');
    if (ok) {
      this.customerName.set('');
      this.customerPhone.set('');
    }
  }
}

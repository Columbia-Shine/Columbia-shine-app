import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api, MoneyPipe, shrinkPhoto, Toast, WhenPipe } from '../core';

const MAX_PHOTOS = 6;

@Component({
  selector: 'app-recepcion',
  imports: [FormsModule, MoneyPipe, WhenPipe],
  template: `
    <main class="page">
      <h1>Recibir moto</h1>
      <div class="split">
        <div class="main col" style="gap: 20px">
          <section class="card col">
            <label class="rotulo" for="placa">1 · Placa</label>
            <div class="row">
              @if (noPlate()) {
                <div class="tile grow" style="flex-basis: 260px">
                  <div class="fuerte">Moto sin placa</div>
                  <div class="chico suave">Se le asigna un código interno (SP0001…) que sale en la orden y el comprobante.</div>
                </div>
              } @else {
                <input id="placa" class="campo grande" style="width: 220px; text-transform: uppercase; letter-spacing: 0.08em" maxlength="8"
                  autocomplete="off" [ngModel]="plate()" (ngModelChange)="onPlate($event)" />
              }
              <button class="pastilla" [attr.aria-pressed]="noPlate()" (click)="toggleNoPlate()">Moto sin placa</button>
              @if (noPlate()) {
              } @else if (bike(); as b) {
                <div class="tile grow" style="flex-basis: 260px">
                  <div class="fuerte">{{ b.brand }} {{ b.model }} @if (b.color) { · {{ b.color }} }</div>
                  <div class="chico suave">
                    {{ b.customer_name }} @if (b.customer_phone) { · {{ b.customer_phone }} } · {{ b.visits }} visitas
                    @if (b.last_visit) { · última: {{ b.last_visit.service }}, {{ b.last_visit.date | cuando: 'fecha' }} }
                  </div>
                  @if (b.notes) { <div class="chico amarillo">Nota de la moto: {{ b.notes }}</div> }
                  @if (b.membership; as m) {
                    <div class="chico amarillo">Membresía {{ m.name }}: quedan {{ m.remaining }} lavados de {{ m.service_name }}. Se usa al cobrar.</div>
                  }
                </div>
              } @else if (searched()) {
                <span class="etiqueta azul">Moto nueva: completa los datos</span>
              }
            </div>
            @if (bike()?.customer_pending) {
              <div class="aviso col" style="gap: 10px">
                <div><span class="fuerte amarillo">Cliente de afán:</span> esta placa no tiene los datos del cliente. Si ahora tiene tiempo, complétalos (opcional).</div>
                <div class="grid">
                  <div><label for="pn">Nombre del cliente</label><input id="pn" class="campo" [(ngModel)]="customerName" autocomplete="off" /></div>
                  <div><label for="pp">Celular</label><input id="pp" class="campo" type="tel" inputmode="numeric" [(ngModel)]="customerPhone" autocomplete="off" /></div>
                </div>
              </div>
            }
            @if ((searched() || noPlate()) && !bike()) {
              <div class="row">
                <button class="pastilla" [attr.aria-pressed]="mode() === 'nuevo'" (click)="setMode('nuevo')">Cliente nuevo</button>
                <button class="pastilla" [attr.aria-pressed]="mode() === 'existente'" (click)="setMode('existente')">Ya es cliente: otra moto</button>
                <button class="pastilla" [attr.aria-pressed]="mode() === 'afan'" (click)="setMode('afan')">Cliente de afán: solo placa</button>
              </div>
              @if (mode() === 'afan') {
                <p class="chico suave">Se registra con la placa como "Sin registrar". Cuando vuelva, al escribir la placa aquí se completan sus datos y queda con todo su historial.</p>
              }
              @if (mode() === 'existente') {
                @if (owner(); as c) {
                  <div class="tile row">
                    <div class="grow">
                      <div class="fuerte">{{ c.name }}</div>
                      <div class="chico suave">{{ c.phone || 'Sin celular' }} @if (c.plates) { · motos: {{ c.plates }} }</div>
                    </div>
                    <button class="btn chico" (click)="owner.set(null)">Cambiar</button>
                  </div>
                } @else {
                  <div>
                    <label for="bc">Buscar cliente por nombre, celular o placa</label>
                    <input id="bc" class="campo" type="search" autocomplete="off" [ngModel]="ownerTerm()" (ngModelChange)="searchOwner($event)" />
                  </div>
                  @for (c of ownerResults(); track c.id) {
                    <button class="opcion row between" (click)="owner.set(c)">
                      <span class="fuerte">{{ c.name }}</span>
                      <span class="chico suave">{{ c.phone || 'Sin celular' }} @if (c.plates) { · {{ c.plates }} }</span>
                    </button>
                  } @empty {
                    @if (ownerTerm().trim().length >= 2) { <p class="chico suave">Ningún cliente coincide. Revisa o elige "Cliente nuevo".</p> }
                  }
                }
              }
              <div class="grid">
                @if (mode() === 'nuevo') {
                  <div><label for="cn">Nombre del cliente</label><input id="cn" class="campo" [(ngModel)]="customerName" autocomplete="off" /></div>
                  <div><label for="cp">Celular</label><input id="cp" class="campo" type="tel" inputmode="numeric" [(ngModel)]="customerPhone" autocomplete="off" /></div>
                }
                <div><label for="br">Marca{{ noPlate() ? ' (obligatoria)' : '' }}</label><input id="br" class="campo" [(ngModel)]="brand" /></div>
                @if (noPlate()) {
                  <div><label for="bn">Cómo reconocerla (color, detalles)</label><input id="bn" class="campo" placeholder="Ej.: roja, sticker en el tanque" [(ngModel)]="bikeNote" /></div>
                }
              </div>
            }
          </section>

          <section class="card col">
            <p class="rotulo">2 · Servicio</p>
            <div class="grid">
              @for (s of bases(); track s.id) {
                <button class="opcion servicio" [attr.aria-pressed]="serviceId() === s.id" (click)="serviceId.set(s.id)">
                  <span class="chico amarillo" style="min-height: 18px">{{ s.recommended ? 'Recomendado' : '' }}</span>
                  <span style="font-size: 17px; font-weight: 800; font-style: italic">{{ s.name }}</span>
                  <span class="num" style="font-size: 24px">{{ s.price | money }}</span>
                  <span class="chico suave">{{ s.min_minutes }}–{{ s.max_minutes }} min · {{ s.focus }}</span>
                </button>
              }
            </div>
          </section>

          <section class="card col">
            <p class="rotulo">3 · Adicionales</p>
            <div class="row">
              @for (e of extras(); track e.id) {
                <button class="pastilla" style="min-height: 48px" [attr.aria-pressed]="extraIds().includes(e.id)" (click)="toggleExtra(e.id)">
                  {{ e.name }} · {{ e.price_from ? 'desde ' : '' }}{{ e.price | money }}
                </button>
              }
            </div>
            <p class="chico suave">Óxido y desmanchado son "desde": el valor final se confirma con el cliente y se ajusta en la orden antes de intervenir.</p>
          </section>

          <section class="card col">
            <p class="rotulo">4 · Estado al recibir</p>
            <div class="fotos">
              @for (p of photos(); track $index) {
                <div style="position: relative">
                  <img [src]="p" alt="Foto {{ $index + 1 }} de la moto al recibir" />
                  <button class="quitar" [attr.aria-label]="'Quitar foto ' + ($index + 1)" (click)="removePhoto($index)">×</button>
                </div>
              }
              @if (photos().length < maxPhotos) {
                <label class="tomar" for="foto">Tomar foto</label>
                <input id="foto" type="file" accept="image/*" capture="environment" hidden (change)="addPhoto($event)" />
              }
            </div>
            <div>
              <label for="obs">Daños existentes y observaciones</label>
              <textarea id="obs" class="campo" rows="2" [(ngModel)]="notes"></textarea>
            </div>
            <p class="chico suave">Nunca se asume responsabilidad por daños que ya estaban y no se registraron.</p>
          </section>
        </div>

        <aside class="card side col">
          <p class="rotulo">Resumen</p>
          @if (service(); as s) {
            <div class="row between"><span class="fuerte">{{ s.name }}</span><span class="num">{{ s.price | money }}</span></div>
            @for (e of chosenExtras(); track e.id) {
              <div class="row between suave" style="flex-wrap: nowrap; align-items: flex-start"><span>{{ e.name }}</span><span class="num">{{ e.price | money }}</span></div>
            }
            <div class="row between sep"><span class="fuerte">Total</span><span class="total">{{ total() | money }}</span></div>
            <p class="chico suave">Tiempo objetivo: {{ s.min_minutes }}–{{ s.max_minutes }} min</p>
          } @else {
            <p class="suave">Elige el servicio para ver el total.</p>
          }
          <div>
            <label for="lav">Lavador</label>
            <select id="lav" class="campo" [(ngModel)]="washerId">
              <option value="">Asignar después</option>
              @for (w of washers(); track w.id) { <option [value]="w.id">{{ w.name }}</option> }
            </select>
          </div>
          <button class="btn primario grande" [disabled]="busy()" (click)="create()">Crear orden</button>
          <button class="btn" [disabled]="busy()" (click)="create(true)">Crear y recibir otra moto de este cliente</button>
          @if (received().length) {
            <p class="chico suave">Ya recibidas de este cliente: {{ received().join(', ') }}</p>
          }
        </aside>
      </div>
    </main>
  `,
  styles: `
    .servicio { display: flex; flex-direction: column; gap: 6px; min-height: 128px; padding: 16px; }
    .tomar { width: 120px; height: 90px; margin: 0; border-radius: 10px; border: 2px dashed var(--borde); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; font-size: 14px; cursor: pointer; }
    .quitar { position: absolute; top: -8px; right: -8px; width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--negro); color: #fff; font-size: 20px; cursor: pointer; }
  `,
})
export class Recepcion {
  private api = inject(Api);
  private toast = inject(Toast);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  protected maxPhotos = MAX_PHOTOS;
  protected services = signal<any[]>([]);
  protected washers = signal<any[]>([]);
  protected plate = signal('');
  protected bike = signal<any | null>(null);
  protected searched = signal(false);
  /** De quién es una moto nueva: cliente nuevo, uno que ya existe (otra moto suya) o de afán (solo placa) */
  protected mode = signal<'nuevo' | 'existente' | 'afan'>('nuevo');
  protected owner = signal<any | null>(null);
  protected ownerTerm = signal('');
  protected ownerResults = signal<any[]>([]);
  private ownerTimer: ReturnType<typeof setTimeout> | undefined;
  protected customerName = signal('');
  protected customerPhone = signal('');
  protected brand = signal('');
  /** Moto sin placa: no se busca placa y se pide cómo reconocerla */
  protected noPlate = signal(false);
  protected bikeNote = signal('');
  protected serviceId = signal('');
  protected extraIds = signal<string[]>([]);
  protected photos = signal<string[]>([]);
  protected notes = signal('');
  protected washerId = signal('');
  protected busy = signal(false);
  private bookingId = '';
  private lookupTimer: ReturnType<typeof setTimeout> | undefined;

  protected bases = computed(() => this.services().filter((s) => s.kind === 'BASE'));
  protected extras = computed(() => this.services().filter((s) => s.kind === 'EXTRA'));
  protected service = computed(() => this.services().find((s) => s.id === this.serviceId()));
  protected chosenExtras = computed(() => this.extras().filter((e) => this.extraIds().includes(e.id)));
  protected total = computed(() => (this.service()?.price ?? 0) + this.chosenExtras().reduce((a, e) => a + e.price, 0));

  constructor() {
    const p = this.route.snapshot.queryParamMap;
    this.bookingId = p.get('reserva') ?? '';
    this.customerName.set(p.get('nombre') ?? '');
    this.customerPhone.set(p.get('celular') ?? '');
    this.serviceId.set(p.get('servicio') ?? '');
    Promise.all([this.api.get('/services'), this.api.get('/users')]).then(([s, u]) => {
      this.services.set(s);
      this.washers.set(u.filter((x: any) => x.washes));
    }, this.toast.fail);
    if (p.get('placa')) this.onPlate(p.get('placa')!);
  }

  onPlate(value: string) {
    const plate = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    this.plate.set(plate);
    this.bike.set(null);
    this.searched.set(false);
    clearTimeout(this.lookupTimer);
    if (plate.length < 5) return;
    this.lookupTimer = setTimeout(async () => {
      try {
        const found = await this.api.get('/bikes/lookup?plate=' + plate);
        if (this.plate() !== plate) return;
        this.bike.set(found);
        this.searched.set(true);
        // Con membresía vigente se propone su servicio
        if (found?.membership?.remaining > 0 && !this.serviceId()) this.serviceId.set(found.membership.service_id);
      } catch (e) {
        this.toast.fail(e);
      }
    }, 350);
  }

  setMode(mode: 'nuevo' | 'existente' | 'afan') {
    this.mode.set(mode);
    this.owner.set(null);
  }

  searchOwner(value: string) {
    this.ownerTerm.set(value);
    clearTimeout(this.ownerTimer);
    const term = value.trim();
    if (term.length < 2) return this.ownerResults.set([]);
    this.ownerTimer = setTimeout(async () => {
      try {
        const found: any[] = await this.api.get('/customers?q=' + encodeURIComponent(term));
        // Los clientes de afán no se ofrecen: todavía no tienen datos
        if (this.ownerTerm().trim() === term) this.ownerResults.set(found.filter((c) => !c.pending).slice(0, 6));
      } catch (e) {
        this.toast.fail(e);
      }
    }, 300);
  }

  toggleExtra(id: string) {
    this.extraIds.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async addPhoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const url = await shrinkPhoto(file);
      this.photos.update((p) => [...p, url]);
    } catch {
      this.toast.show('No se pudo leer esa foto. Intenta de nuevo.', true);
    }
  }

  removePhoto(index: number) {
    this.photos.update((p) => p.filter((_, i) => i !== index));
  }

  /** Órdenes creadas en esta recepción para el mismo cliente (cuando trae varias motos). */
  protected received = signal<string[]>([]);

  /** Deja el formulario listo para otra moto del mismo cliente, sin volver a escribir sus datos. */
  private nextBike(order: any) {
    this.received.update((r) => [...r, `${order.plate} (${order.code})`]);
    this.plate.set('');
    this.bike.set(null);
    this.searched.set(false);
    this.brand.set('');
    this.noPlate.set(false);
    this.bikeNote.set('');
    this.extraIds.set([]);
    this.photos.set([]);
    this.notes.set('');
    this.washerId.set('');
    this.bookingId = '';
    this.mode.set('existente');
    this.owner.set({ id: order.customer_id, name: order.customer_name, phone: order.customer_phone, plates: order.plate });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => document.getElementById('placa')?.focus(), 300);
  }

  toggleNoPlate() {
    this.noPlate.update((v) => !v);
    this.plate.set('');
    this.bike.set(null);
    this.searched.set(false);
  }

  async create(another = false) {
    if (this.noPlate()) {
      if (!this.brand().trim() || !this.bikeNote().trim()) return this.toast.show('Escribe la marca y cómo reconocer la moto sin placa.', true);
    } else {
      if (this.plate().length < 5) return this.toast.show('Escribe la placa o marca "Moto sin placa".', true);
      if (!this.searched()) return this.toast.show('Espera un momento: estamos buscando la placa.', true);
    }
    if (!this.serviceId()) return this.toast.show('Elige el servicio.', true);
    const isNew = !this.bike();
    if (isNew && this.mode() === 'existente' && !this.owner()) return this.toast.show('Busca y elige el cliente dueño de la moto.', true);
    this.busy.set(true);
    try {
      const order = await this.api.post('/orders', {
        plate: this.plate(),
        noPlate: this.noPlate(),
        bikeNote: this.bikeNote(),
        rush: isNew && this.mode() === 'afan',
        customerId: isNew && this.mode() === 'existente' ? this.owner()?.id : null,
        customerName: this.customerName(),
        customerPhone: this.customerPhone(),
        brand: this.brand(),
        serviceId: this.serviceId(),
        extraIds: this.extraIds(),
        notes: this.notes(),
        washerId: this.washerId() || null,
        photos: this.photos(),
        bookingId: this.bookingId || null,
      });
      if (another) {
        this.toast.show(`Orden ${order.code} creada. Escribe la placa de la otra moto de ${order.customer_name}.`);
        this.nextBike(order);
        return;
      }
      this.toast.show(`Orden ${order.code} creada.`);
      this.router.navigateByUrl('/ordenes');
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
}

import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, MoneyInput, MoneyPipe, ROLE_NAMES, Toast, WhenPipe } from '../core';

const PERMISSIONS: [string, string, string, string][] = [
  ['Recibir moto y crear orden', 'Sí', 'Sí', 'No'],
  ['Asignar y reasignar lavador', 'Sí', 'Sí', 'No'],
  ['Marcar inicio y fin del servicio', 'Sí', 'Sí', 'Sí, las suyas'],
  ['Cobrar y entregar', 'Sí', 'Sí', 'No'],
  ['Borrar o anular un cobro', 'Sí', 'Pide aprobación', 'No'],
  ['Abrir y cerrar caja, registrar gastos', 'Sí', 'Sí', 'No'],
  ['Agendar y cancelar reservas', 'Sí', 'Sí', 'No'],
  ['Cambiar precios y servicios', 'Sí', 'No', 'No'],
  ['Ver reportes y rentabilidad', 'Sí', 'Solo ventas de hoy', 'No'],
  ['Crear usuarios y cambiar permisos', 'Sí', 'No', 'No'],
];

const ACTIONS: Record<string, string> = {
  ORDEN_CREADA: 'Creó una orden', ORDEN_ASIGNADA: 'Asignó lavador', ORDEN_ESTADO: 'Cambió el estado', ORDEN_CANCELADA: 'Canceló una orden',
  CLIENTE_COMPLETADO: 'Completó datos de cliente de afán', CLIENTE_UNIDO: 'Unió cliente de afán con uno existente',
  COBRO_EDITADO: 'Corrigió un cobro', PLAN_CREADO: 'Creó un plan de membresía', PLAN_EDITADO: 'Cambió un plan de membresía', MEMBRESIA_VENDIDA: 'Vendió una membresía', INSUMO_CREADO: 'Creó un insumo', INSUMO_EDITADO: 'Cambió un insumo', INSUMO_COMPRA: 'Registró una compra de insumos', INSUMO_CONTEO: 'Contó un insumo', GASTO_REGISTRADO: 'Registró un gasto por fuera de la caja', GASTO_BORRADO: 'Borró un gasto por fuera de la caja', CLIENTE_CONTACTADO: 'Le escribió a un cliente para que vuelva',
  NOMINA_PAGADA: 'Registró un pago de nómina', NOMINA_DESHECHA: 'Deshizo un pago de nómina', ACUERDO_CREADO: 'Creó un acuerdo de mínimo', ACUERDO_EDITADO: 'Cambió un acuerdo de mínimo',
  ADICIONAL_AGREGADO: 'Agregó un adicional', ADICIONAL_QUITADO: 'Quitó un adicional', COBRO: 'Registró un cobro',
  ANULACION_SOLICITADA: 'Pidió anular un cobro', COBRO_ANULADO: 'Anuló un cobro', ANULACION_RECHAZADA: 'Rechazó una anulación',
  TURNO_ABIERTO: 'Abrió turno', TURNO_CERRADO: 'Cerró turno', MOVIMIENTO_CAJA: 'Movimiento de caja',
  RESERVA_CREADA: 'Creó una reserva', RESERVA_CANCELADA: 'Canceló una reserva',
  USUARIO_CREADO: 'Creó un usuario', USUARIO_EDITADO: 'Editó un usuario', SERVICIO_EDITADO: 'Cambió un precio o servicio',
};

@Component({
  selector: 'app-ajustes',
  imports: [FormsModule, MoneyInput, MoneyPipe, WhenPipe],
  template: `
    <main class="page">
      <h1>Ajustes</h1>
      <div class="split">
        <div class="side col" style="flex-basis: 420px; gap: 20px">
          <section class="card col">
            <h2>Equipo</h2>
            @for (u of users(); track u.id) {
              <div class="tile col" style="gap: 8px" [style.opacity]="u.active ? 1 : 0.6">
                <div class="row between">
                  <div>
                    <div class="fuerte">{{ u.name }} @if (!u.active) { (inactivo) }</div>
                    <div class="chico suave">Usuario: {{ u.username || 'sin usuario' }}@if (u.email) { · {{ u.email }} }</div>
                  </div>
                  <span class="etiqueta" [class.amarilla]="u.role === 'OWNER'" [class.azul]="u.role === 'ADMIN'">{{ u.role === 'ADMIN' && u.washes ? 'Administrador y lava' : roles[u.role] }}</span>
                </div>
                <div class="row">
                  <button class="btn chico" (click)="edit(u)">Cambiar usuario o contraseña</button>
                  @if (u.role === 'ADMIN') {
                    <button class="btn chico" (click)="patch(u, { washes: !u.washes }, u.washes ? 'Ya no se le asignan motos.' : 'Ahora también lava.')">{{ u.washes ? 'Ya no lava' : 'También lava' }}</button>
                  }
                  @if (u.role !== 'OWNER') {
                    <button class="btn chico" (click)="patch(u, { role: u.role === 'ADMIN' ? 'WASHER' : 'ADMIN' }, 'Rol actualizado.')">Pasar a {{ u.role === 'ADMIN' ? 'lavador' : 'administrador' }}</button>
                    <button class="btn chico" (click)="patch(u, { active: !u.active }, u.active ? 'Usuario desactivado.' : 'Usuario activado.')">{{ u.active ? 'Desactivar' : 'Activar' }}</button>
                  }
                </div>
                @if (editing() === u.id) {
                  <div class="col" style="gap: 8px">
                    <div><label [for]="'eu' + u.id">Usuario</label><input [id]="'eu' + u.id" class="campo" autocapitalize="none" autocomplete="off" [(ngModel)]="newUsername" /></div>
                    <div><label [for]="'ep' + u.id">Nueva contraseña (vacía para no cambiarla)</label><input [id]="'ep' + u.id" class="campo" type="password" autocomplete="new-password" [(ngModel)]="newPassword" /></div>
                    <button class="btn chico azul" (click)="saveAccess(u)">Guardar</button>
                  </div>
                }
              </div>
            }
          </section>

          <section class="card col">
            <h2>Crear usuario</h2>
            <div><label for="un">Nombre</label><input id="un" class="campo" [(ngModel)]="name" autocomplete="off" /></div>
            <div class="row">
              <button class="pastilla" [attr.aria-pressed]="role() === 'WASHER'" (click)="role.set('WASHER')">Lavador</button>
              <button class="pastilla" [attr.aria-pressed]="role() === 'ADMIN'" (click)="role.set('ADMIN')">Administrador de turno</button>
            </div>
            @if (role() === 'ADMIN') {
              <label class="check-lava"><input type="checkbox" [checked]="washes()" (change)="washes.set(!washes())" /> <span>También lava (se le asignan motos y gana comisión)</span></label>
            }
            <div><label for="uu">Usuario para entrar</label><input id="uu" class="campo" autocapitalize="none" spellcheck="false" placeholder="ej. gregorio" [(ngModel)]="username" autocomplete="off" /></div>
            <div><label for="uc">Contraseña (mínimo 8 caracteres)</label><input id="uc" class="campo" type="password" [(ngModel)]="password" autocomplete="new-password" /></div>
            <div><label for="ue">Correo (opcional)</label><input id="ue" class="campo" type="email" [(ngModel)]="email" autocomplete="off" /></div>
            <button class="btn primario" (click)="create()">Crear usuario</button>
          </section>
        </div>

        <div class="main col" style="gap: 20px">
          <section class="card col">
            <h2>Servicios y precios</h2>
            <div class="tabla-caja">
              <table style="min-width: 520px">
                <thead><tr><th>Servicio</th><th>Tipo</th><th class="der">Precio</th><th></th></tr></thead>
                <tbody>
                  @for (s of services(); track s.id) {
                    <tr [style.opacity]="s.active ? 1 : 0.55">
                      <td class="fuerte">{{ s.name }}</td>
                      <td>{{ s.kind === 'BASE' ? 'Servicio' : s.price_from ? 'Adicional (desde)' : 'Adicional' }}</td>
                      <td class="der">
                        @if (priceOf() === s.id) {
                          <input class="campo" style="width: 130px; min-height: 44px" dinero [attr.aria-label]="'Precio de ' + s.name" [(ngModel)]="newPrice" />
                        } @else {
                          {{ s.price | money }}
                        }
                      </td>
                      <td class="der">
                        <span class="row" style="justify-content: flex-end; flex-wrap: nowrap">
                          @if (priceOf() === s.id) {
                            <button class="btn chico azul" (click)="savePrice(s)">Guardar</button>
                          } @else {
                            <button class="btn chico" (click)="priceOf.set(s.id); newPrice.set(s.price)">Cambiar precio</button>
                          }
                          <button class="btn chico" (click)="toggleService(s)">{{ s.active ? 'Ocultar' : 'Mostrar' }}</button>
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="chico suave">El cambio de precio aplica a las órdenes nuevas; las que ya están abiertas conservan el valor con el que se crearon.</p>
          </section>

          <section class="card col">
            <h2>Membresías</h2>
            <p class="chico suave">Se venden para una placa desde la ficha del cliente y duran 30 días; los lavados que no use se pierden. El lavador gana su comisión sobre el precio normal del servicio.</p>
            <div class="tabla-caja">
              <table style="min-width: 600px">
                <thead><tr><th>Plan</th><th>Incluye</th><th class="der">Valor normal</th><th class="der">Precio</th><th></th></tr></thead>
                <tbody>
                  @for (p of plans(); track p.id) {
                    <tr [style.opacity]="p.active ? 1 : 0.55">
                      <td class="fuerte">{{ p.name }}</td>
                      <td>{{ p.washes }} × {{ p.service_name }}</td>
                      <td class="der suave">{{ p.washes * p.service_price | money }}</td>
                      <td class="der">
                        @if (planPriceOf() === p.id) {
                          <input class="campo" style="width: 130px; min-height: 44px" dinero [attr.aria-label]="'Precio de ' + p.name" [(ngModel)]="planPrice" />
                        } @else {
                          <span class="fuerte">{{ p.price | money }}</span>
                          <div class="chico amarillo">ahorra {{ saving(p) }}%</div>
                        }
                      </td>
                      <td class="der">
                        <span class="row" style="justify-content: flex-end; flex-wrap: nowrap">
                          @if (planPriceOf() === p.id) {
                            <button class="btn chico azul" (click)="savePlanPrice(p)">Guardar</button>
                          } @else {
                            <button class="btn chico" (click)="planPriceOf.set(p.id); planPrice.set(p.price)">Cambiar precio</button>
                          }
                          <button class="btn chico" (click)="togglePlan(p)">{{ p.active ? 'Ocultar' : 'Mostrar' }}</button>
                        </span>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="5" class="suave">Todavía no hay planes.</td></tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="sep col">
              <p class="rotulo">Nuevo plan</p>
              <div class="grid">
                <div><label for="pl-n">Nombre</label><input id="pl-n" class="campo" placeholder="Ej.: Plus" [(ngModel)]="planName" /></div>
                <div>
                  <label for="pl-s">Servicio que incluye</label>
                  <select id="pl-s" class="campo" [(ngModel)]="planService">
                    <option value="">Elegir…</option>
                    @for (s of baseServices(); track s.id) { <option [value]="s.id">{{ s.name }} · {{ s.price | money }}</option> }
                  </select>
                </div>
                <div><label for="pl-w">Lavados en 30 días</label><input id="pl-w" class="campo" type="number" min="1" inputmode="numeric" [(ngModel)]="planWashes" /></div>
                <div><label for="pl-p">Precio</label><input id="pl-p" class="campo" dinero [(ngModel)]="planNewPrice" /></div>
              </div>
              <button class="btn" style="align-self: flex-start" (click)="createPlan()">Crear plan</button>
            </div>
          </section>

          <section class="card col">
            <h2>Qué puede hacer cada rol</h2>
            <div class="tabla-caja">
              <table style="min-width: 560px">
                <thead><tr><th>Acción</th><th>Propietario</th><th>Administrador de turno</th><th>Lavador</th></tr></thead>
                <tbody>
                  @for (p of permissions; track p[0]) {
                    <tr><td>{{ p[0] }}</td><td class="fuerte">{{ p[1] }}</td><td class="fuerte" [class.amarillo]="p[2] !== 'Sí' && p[2] !== 'No'" [class.suave]="p[2] === 'No'">{{ p[2] }}</td><td class="fuerte" [class.suave]="p[3] === 'No'">{{ p[3] }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <section class="card col">
            <h2>Historial de acciones</h2>
            <div class="tabla-caja">
              <table style="min-width: 560px">
                <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué hizo</th><th>Detalle</th></tr></thead>
                <tbody>
                  @for (a of audit(); track a.id) {
                    <tr><td style="white-space: nowrap">{{ a.created_at | cuando: 'completa' }}</td><td>{{ a.user_name || '—' }}</td><td class="fuerte">{{ actions[a.action] || a.action }}</td><td class="chico suave">{{ detail(a.detail) }}</td></tr>
                  } @empty {
                    <tr><td colspan="4" class="suave">Aún no hay acciones registradas.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  `,
  styles: `
    .check-lava { display: flex; align-items: center; gap: 12px; min-height: 44px; margin: 0; font-size: 15px; color: #fff; cursor: pointer; }
    .check-lava input { width: 22px; height: 22px; accent-color: var(--amarillo); flex: 0 0 auto; }
  `,
})
export class Ajustes {
  private api = inject(Api);
  private toast = inject(Toast);

  protected roles: Record<string, string> = ROLE_NAMES;
  protected permissions = PERMISSIONS;
  protected actions = ACTIONS;
  protected users = signal<any[]>([]);
  protected services = signal<any[]>([]);
  protected audit = signal<any[]>([]);
  protected editing = signal('');
  protected newUsername = signal('');
  protected newPassword = signal('');
  protected name = signal('');
  protected role = signal<'WASHER' | 'ADMIN'>('WASHER');
  protected washes = signal(false);
  protected username = signal('');
  protected email = signal('');
  protected password = signal('');
  protected priceOf = signal('');
  protected newPrice = signal<number | null>(null);

  constructor() {
    this.load();
  }

  // ---- Membresías ----
  protected plans = signal<any[]>([]);
  protected planName = signal('');
  protected planService = signal('');
  protected planWashes = signal<number | null>(4);
  protected planNewPrice = signal<number | null>(null);
  protected planPriceOf = signal('');
  protected planPrice = signal<number | null>(null);
  protected baseServices = computed(() => this.services().filter((s) => s.kind === 'BASE' && s.active));
  saving = (p: any) => Math.max(0, Math.round((1 - p.price / (p.washes * p.service_price)) * 100));

  createPlan() {
    this.run(async () => {
      await this.api.post('/membership-plans', { name: this.planName(), serviceId: this.planService(), washes: Number(this.planWashes()), price: Number(this.planNewPrice()) });
      this.planName.set('');
      this.planNewPrice.set(null);
    }, 'Plan creado.');
  }

  savePlanPrice(p: any) {
    this.run(async () => {
      await this.api.patch('/membership-plans/' + p.id, { price: Number(this.planPrice()) });
      this.planPriceOf.set('');
    }, 'Precio del plan actualizado.');
  }

  togglePlan(p: any) {
    this.run(() => this.api.patch('/membership-plans/' + p.id, { active: !p.active }), p.active ? 'Plan oculto.' : 'Plan visible.');
  }

  private async load() {
    try {
      const [users, services, audit, plans] = await Promise.all([
        this.api.get('/users'), this.api.get('/services'), this.api.get('/audit'), this.api.get('/membership-plans'),
      ]);
      this.plans.set(plans);
      this.users.set(users);
      this.services.set(services);
      this.audit.set(audit);
    } catch (e) {
      this.toast.fail(e);
    }
  }

  detail(d: Record<string, unknown> | null): string {
    if (!d) return '';
    return Object.entries(d)
      .filter(([, v]) => v !== null && v !== '')
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k}: ${v.join(', ')}`;
        // Por ejemplo, el antes y el después de un cobro corregido
        if (typeof v === 'object') return `${k}: (${Object.entries(v as object).filter(([, x]) => x !== null && x !== '').map(([a, x]) => `${a} ${x}`).join(', ')})`;
        return `${k}: ${v}`;
      })
      .join(' · ');
  }

  private async run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      this.toast.show(done);
      await this.load();
    } catch (e) {
      this.toast.fail(e);
    }
  }

  patch(u: any, body: unknown, done: string) {
    this.run(async () => {
      await this.api.patch('/users/' + u.id, body);
      this.editing.set('');
    }, done);
  }

  edit(u: any) {
    this.editing.set(this.editing() === u.id ? '' : u.id);
    this.newUsername.set(u.username ?? '');
    this.newPassword.set('');
  }

  saveAccess(u: any) {
    const body: Record<string, string> = {};
    if (this.newUsername().trim() !== (u.username ?? '')) body['username'] = this.newUsername();
    if (this.newPassword()) body['password'] = this.newPassword();
    if (!Object.keys(body).length) return this.toast.show('No hay cambios.', true);
    this.patch(u, body, 'Acceso actualizado.');
  }

  create() {
    this.run(async () => {
      await this.api.post('/users', { name: this.name(), role: this.role(), username: this.username(), email: this.email(), password: this.password(), washes: this.role() === 'ADMIN' && this.washes() });
      this.name.set('');
      this.username.set('');
      this.washes.set(false);
      this.email.set('');
      this.password.set('');
    }, 'Usuario creado.');
  }

  savePrice(s: any) {
    this.run(async () => {
      await this.api.patch('/services/' + s.id, { price: Number(this.newPrice()) });
      this.priceOf.set('');
    }, 'Precio actualizado.');
  }

  toggleService(s: any) {
    this.run(() => this.api.patch('/services/' + s.id, { active: !s.active }), s.active ? 'Servicio oculto.' : 'Servicio visible.');
  }
}

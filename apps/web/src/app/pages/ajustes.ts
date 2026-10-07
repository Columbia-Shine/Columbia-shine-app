import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, MoneyPipe, ROLE_NAMES, Toast, WhenPipe } from '../core';

const PERMISSIONS: [string, string, string, string][] = [
  ['Recibir moto y crear orden', 'Sí', 'Sí', 'No'],
  ['Asignar y reasignar lavador', 'Sí', 'Sí', 'No'],
  ['Marcar inicio y fin del servicio', 'Sí', 'Sí', 'Sí, las suyas'],
  ['Aprobar la revisión de entrega', 'Sí', 'Sí', 'No'],
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
  ADICIONAL_AGREGADO: 'Agregó un adicional', ADICIONAL_QUITADO: 'Quitó un adicional', COBRO: 'Registró un cobro',
  ANULACION_SOLICITADA: 'Pidió anular un cobro', COBRO_ANULADO: 'Anuló un cobro', ANULACION_RECHAZADA: 'Rechazó una anulación',
  TURNO_ABIERTO: 'Abrió turno', TURNO_CERRADO: 'Cerró turno', MOVIMIENTO_CAJA: 'Movimiento de caja',
  RESERVA_CREADA: 'Creó una reserva', RESERVA_CANCELADA: 'Canceló una reserva',
  USUARIO_CREADO: 'Creó un usuario', USUARIO_EDITADO: 'Editó un usuario', SERVICIO_EDITADO: 'Cambió un precio o servicio',
};

@Component({
  selector: 'app-ajustes',
  imports: [FormsModule, MoneyPipe, WhenPipe],
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
                    <div class="chico suave">{{ u.email || 'Sin correo' }} · {{ u.has_pin ? 'con PIN' : 'sin PIN' }}</div>
                  </div>
                  <span class="etiqueta" [class.amarilla]="u.role === 'OWNER'" [class.azul]="u.role === 'ADMIN'">{{ roles[u.role] }}</span>
                </div>
                <div class="row">
                  <button class="btn chico" (click)="editing.set(editing() === u.id ? '' : u.id); newPin.set('')">Cambiar PIN</button>
                  @if (u.role !== 'OWNER') {
                    <button class="btn chico" (click)="patch(u, { role: u.role === 'ADMIN' ? 'WASHER' : 'ADMIN' }, 'Rol actualizado.')">Pasar a {{ u.role === 'ADMIN' ? 'lavador' : 'administrador' }}</button>
                    <button class="btn chico" (click)="patch(u, { active: !u.active }, u.active ? 'Usuario desactivado.' : 'Usuario activado.')">{{ u.active ? 'Desactivar' : 'Activar' }}</button>
                  }
                </div>
                @if (editing() === u.id) {
                  <div class="row">
                    <input class="campo" style="width: 150px" inputmode="numeric" maxlength="4" placeholder="Nuevo PIN" aria-label="Nuevo PIN de 4 dígitos" [(ngModel)]="newPin" />
                    <button class="btn chico azul" (click)="patch(u, { pin: newPin() }, 'PIN actualizado.')">Guardar PIN</button>
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
            <div><label for="up">PIN de 4 dígitos</label><input id="up" class="campo" inputmode="numeric" maxlength="4" [(ngModel)]="pin" autocomplete="off" /></div>
            @if (role() === 'ADMIN') {
              <p class="chico suave">Opcional: correo y contraseña para que entre desde otro equipo, además del PIN.</p>
              <div><label for="ue">Correo</label><input id="ue" class="campo" type="email" [(ngModel)]="email" autocomplete="off" /></div>
              <div><label for="uc">Contraseña (mínimo 8 caracteres)</label><input id="uc" class="campo" type="password" [(ngModel)]="password" autocomplete="new-password" /></div>
            }
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
                          <input class="campo" style="width: 130px; min-height: 44px" type="number" inputmode="numeric" step="1000" min="1" [attr.aria-label]="'Precio de ' + s.name" [(ngModel)]="newPrice" />
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
  protected newPin = signal('');
  protected name = signal('');
  protected role = signal<'WASHER' | 'ADMIN'>('WASHER');
  protected pin = signal('');
  protected email = signal('');
  protected password = signal('');
  protected priceOf = signal('');
  protected newPrice = signal<number | null>(null);

  constructor() {
    this.load();
  }

  private async load() {
    try {
      const [users, services, audit] = await Promise.all([this.api.get('/users'), this.api.get('/services'), this.api.get('/audit')]);
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
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
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

  create() {
    this.run(async () => {
      await this.api.post('/users', { name: this.name(), role: this.role(), pin: this.pin(), email: this.email(), password: this.password() });
      this.name.set('');
      this.pin.set('');
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

import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Toast, WhenPipe } from '../core';
import { AjustesNav } from './ajustes-nav';

/** Nombre en español de cada acción del historial. */
export const ACTIONS: Record<string, string> = {
  ORDEN_CREADA: 'Creó una orden', ORDEN_ASIGNADA: 'Asignó lavador', ORDEN_ESTADO: 'Cambió el estado', ORDEN_CANCELADA: 'Canceló una orden',
  CLIENTE_COMPLETADO: 'Completó datos de cliente de afán', CLIENTE_UNIDO: 'Unió cliente de afán con uno existente', CLIENTE_CONTACTADO: 'Le escribió a un cliente para que vuelva',
  COBRO: 'Registró un cobro', COBRO_EDITADO: 'Corrigió un cobro', COBRO_CONJUNTO: 'Cobró varias motos juntas',
  ANULACION_SOLICITADA: 'Pidió anular un cobro', COBRO_ANULADO: 'Anuló un cobro', ANULACION_RECHAZADA: 'Rechazó una anulación',
  ADICIONAL_AGREGADO: 'Agregó un adicional', ADICIONAL_QUITADO: 'Quitó un adicional',
  TURNO_ABIERTO: 'Abrió turno', TURNO_CERRADO: 'Cerró turno', MOVIMIENTO_CAJA: 'Movimiento de caja',
  RESERVA_CREADA: 'Creó una reserva', RESERVA_CANCELADA: 'Canceló una reserva',
  USUARIO_CREADO: 'Creó un usuario', USUARIO_EDITADO: 'Editó un usuario', SERVICIO_EDITADO: 'Cambió un precio o servicio',
  NOMINA_PAGADA: 'Registró un pago de nómina', NOMINA_DESHECHA: 'Deshizo un pago de nómina', ACUERDO_CREADO: 'Creó un acuerdo de mínimo', ACUERDO_EDITADO: 'Cambió un acuerdo de mínimo',
  GASTO_REGISTRADO: 'Registró un gasto por fuera de la caja', GASTO_BORRADO: 'Borró un gasto por fuera de la caja',
  INSUMO_CREADO: 'Creó un insumo', INSUMO_EDITADO: 'Cambió un insumo', INSUMO_COMPRA: 'Registró una compra de insumos', INSUMO_CONTEO: 'Contó un insumo',
  PLAN_CREADO: 'Creó un plan de membresía', PLAN_EDITADO: 'Cambió un plan de membresía', MEMBRESIA_VENDIDA: 'Vendió una membresía',
  PAGINA_EDITADA: 'Editó la página pública', OPINION_PUBLICADA: 'Publicó una opinión', OPINION_OCULTA: 'Ocultó una opinión', OPINION_PENDIENTE: 'Devolvió una opinión a revisión',
};

/** Detalle legible de una acción, incluido el antes y el después de un cobro corregido. */
export function auditDetail(d: Record<string, unknown> | null): string {
  if (!d) return '';
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== '')
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: ${v.join(', ')}`;
      if (typeof v === 'object') return `${k}: (${Object.entries(v as object).filter(([, x]) => x !== null && x !== '').map(([a, x]) => `${a} ${x}`).join(', ')})`;
      return `${k}: ${v}`;
    })
    .join(' · ');
}

/** Auditoría: todo lo sensible que pasa en la app, quién y cuándo. Paginada de a 10. */
@Component({
  selector: 'app-auditoria',
  imports: [FormsModule, WhenPipe, AjustesNav],
  template: `
    <main class="page">
      <h1>Ajustes</h1>
      <app-ajustes-nav />

      <div class="row between">
        <p class="suave">Cada acción sensible queda registrada con quién la hizo y cuándo. No se puede borrar.</p>
        <div class="row">
          <select class="campo" style="width: 200px" aria-label="Filtrar por persona" [ngModel]="user()" (ngModelChange)="setUser($event)">
            <option value="">Todas las personas</option>
            @for (u of users(); track u.id) { <option [value]="u.id">{{ u.name }}</option> }
          </select>
          <select class="campo" style="width: 260px" aria-label="Filtrar por tipo de acción" [ngModel]="action()" (ngModelChange)="setAction($event)">
            <option value="">Todas las acciones</option>
            @for (a of actionList(); track a) { <option [value]="a">{{ actions[a] || a }}</option> }
          </select>
        </div>
      </div>

      <section class="card col">
        <div class="tabla-caja">
          <table style="min-width: 640px">
            <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué hizo</th><th>Detalle</th></tr></thead>
            <tbody>
              @for (a of rows(); track a.id) {
                <tr>
                  <td style="white-space: nowrap">{{ a.created_at | cuando: 'completa' }}</td>
                  <td>{{ a.user_name || '—' }}</td>
                  <td class="fuerte">{{ actions[a.action] || a.action }}</td>
                  <td class="chico suave">{{ detail(a.detail) }}</td>
                </tr>
              } @empty {
                <tr><td colspan="4" class="suave">{{ loading() ? 'Cargando…' : 'No hay acciones con ese filtro.' }}</td></tr>
              }
            </tbody>
          </table>
        </div>
        <div class="row between">
          <span class="chico suave">{{ total() }} acciones · página {{ page() }} de {{ pages() }}</span>
          <div class="row">
            <button class="btn chico" [disabled]="page() <= 1" (click)="go(1)" aria-label="Primera página">«</button>
            <button class="btn chico" [disabled]="page() <= 1" (click)="go(page() - 1)">Anterior</button>
            <button class="btn chico" [disabled]="page() >= pages()" (click)="go(page() + 1)">Siguiente</button>
            <button class="btn chico" [disabled]="page() >= pages()" (click)="go(pages())" aria-label="Última página">»</button>
          </div>
        </div>
      </section>
    </main>
  `,
})
export class Auditoria {
  private api = inject(Api);
  private toast = inject(Toast);

  protected actions = ACTIONS;
  protected detail = auditDetail;
  protected rows = signal<any[]>([]);
  protected total = signal(0);
  protected page = signal(1);
  protected pages = signal(1);
  protected users = signal<any[]>([]);
  protected actionList = signal<string[]>([]);
  protected user = signal('');
  protected action = signal('');
  protected loading = signal(true);

  constructor() {
    this.load();
  }

  setUser(v: string) {
    this.user.set(v);
    this.go(1);
  }

  setAction(v: string) {
    this.action.set(v);
    this.go(1);
  }

  go(p: number) {
    this.page.set(p);
    this.load();
  }

  private load() {
    const qs = new URLSearchParams({ page: String(this.page()), size: '10', user: this.user(), action: this.action() });
    this.loading.set(true);
    this.api.get('/audit?' + qs).then((d) => {
      this.rows.set(d.rows);
      this.total.set(d.total);
      this.pages.set(d.pages);
      this.users.set(d.users);
      this.actionList.set(d.actions);
      this.loading.set(false);
    }, this.toast.fail);
  }
}

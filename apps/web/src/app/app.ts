import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ROLE_NAMES, Session, Toast } from './core';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (session.user(); as u) {
      <header class="barra-superior">
        <a routerLink="/" aria-label="Inicio"><img src="logo.png" alt="Columbia Shine" width="52" height="50" /></a>
        <nav aria-label="Principal">
          @for (l of links(); track l.path) {
            <a [routerLink]="l.path" routerLinkActive="activo" [routerLinkActiveOptions]="{ exact: l.path === '/' }">{{ l.label }}</a>
          }
        </nav>
        <div class="quien">
          <span>{{ u.name }} · {{ roles[u.role] }}</span>
          <button class="btn chico" (click)="logout()">Salir</button>
        </div>
      </header>
    }
    <router-outlet />
    @if (toast.message(); as m) {
      <div class="toast" [class.error]="m.error" role="status">{{ m.text }}</div>
    }
  `,
  styles: `
    .barra-superior { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 24px; padding: 8px 20px; background: var(--negro); border-bottom: 1px solid var(--gris-oscuro); }
    img { display: block; object-fit: contain; }
    nav { display: flex; flex-wrap: wrap; gap: 2px; flex: 1 1 auto; }
    nav a { padding: 13px 12px; font-weight: 600; color: var(--texto-suave); border-bottom: 3px solid transparent; }
    nav a:hover { color: #fff; }
    nav a.activo { color: var(--amarillo); font-weight: 700; border-bottom-color: var(--amarillo); }
    .quien { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--texto-suave); margin-left: auto; }
    .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 14px 20px; border-radius: 12px; background: var(--azul-oscuro); color: #fff; font-weight: 600; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5); z-index: 50; }
    .toast.error { background: var(--amarillo); color: var(--negro); }
  `,
})
export class App {
  protected session = inject(Session);
  protected toast = inject(Toast);
  private router = inject(Router);
  protected roles = ROLE_NAMES;

  protected links = computed(() => {
    const role = this.session.user()?.role;
    if (role !== 'OWNER' && role !== 'ADMIN') return [];
    const base = [
      { path: '/', label: 'Inicio' },
      { path: '/recepcion', label: 'Recepción' },
      { path: '/ordenes', label: 'Órdenes' },
      { path: '/caja', label: 'Caja' },
      { path: '/agenda', label: 'Agenda' },
      { path: '/clientes', label: 'Clientes' },
      { path: '/reportes', label: role === 'OWNER' ? 'Reportes' : 'Reporte de hoy' },
    ];
    return role === 'OWNER' ? [...base, { path: '/ajustes', label: 'Ajustes' }] : base;
  });

  logout() {
    const client = this.session.is('CLIENT');
    this.session.end();
    this.router.navigateByUrl(client ? '/cliente' : '/ingreso');
  }
}

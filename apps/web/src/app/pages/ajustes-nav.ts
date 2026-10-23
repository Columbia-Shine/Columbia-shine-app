import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** Pestañas de Ajustes: cada una es su propia vista. */
@Component({
  selector: 'app-ajustes-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="pestanas" aria-label="Secciones de ajustes">
      <a routerLink="/ajustes" routerLinkActive="activa" [routerLinkActiveOptions]="{ exact: true }">Equipo y precios</a>
      <a routerLink="/ajustes/pagina" routerLinkActive="activa">Página pública</a>
      <a routerLink="/ajustes/auditoria" routerLinkActive="activa">Auditoría</a>
    </nav>
  `,
  styles: `
    .pestanas { display: flex; gap: 6px; flex-wrap: wrap; border-bottom: 1px solid var(--gris-oscuro); margin-bottom: 4px; }
    .pestanas a { padding: 12px 16px; min-height: 44px; display: flex; align-items: center; color: var(--texto-suave); font-weight: 700; border-bottom: 3px solid transparent; }
    .pestanas a:hover { color: #fff; }
    .pestanas a.activa { color: var(--amarillo); border-bottom-color: var(--amarillo); }
  `,
})
export class AjustesNav {}

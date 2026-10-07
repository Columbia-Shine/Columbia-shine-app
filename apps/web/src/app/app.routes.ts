import { Routes } from '@angular/router';
import { only } from './core';

const managers = only('OWNER', 'ADMIN');

export const routes: Routes = [
  { path: 'ingreso', title: 'Ingreso · Columbia Shine', loadComponent: () => import('./pages/ingreso').then((m) => m.Ingreso) },
  { path: 'cliente', title: 'Agenda tu lavado · Columbia Shine', loadComponent: () => import('./pages/ingreso').then((m) => m.IngresoCliente) },
  { path: '', pathMatch: 'full', title: 'Inicio · Columbia Shine', canActivate: [managers], loadComponent: () => import('./pages/inicio').then((m) => m.Inicio) },
  { path: 'recepcion', title: 'Recepción · Columbia Shine', canActivate: [managers], loadComponent: () => import('./pages/recepcion').then((m) => m.Recepcion) },
  { path: 'ordenes', title: 'Órdenes · Columbia Shine', canActivate: [managers], loadComponent: () => import('./pages/ordenes').then((m) => m.Ordenes) },
  { path: 'ordenes/:id', title: 'Orden · Columbia Shine', canActivate: [managers], loadComponent: () => import('./pages/orden').then((m) => m.Orden) },
  { path: 'cobro/:id', title: 'Cobro · Columbia Shine', canActivate: [managers], loadComponent: () => import('./pages/orden').then((m) => m.Cobro) },
  { path: 'caja', title: 'Caja · Columbia Shine', canActivate: [managers], loadComponent: () => import('./pages/caja').then((m) => m.Caja) },
  { path: 'agenda', title: 'Agenda · Columbia Shine', canActivate: [managers], loadComponent: () => import('./pages/agenda').then((m) => m.Agenda) },
  { path: 'clientes', title: 'Clientes · Columbia Shine', canActivate: [managers], loadComponent: () => import('./pages/clientes').then((m) => m.Clientes) },
  { path: 'clientes/:id', title: 'Cliente · Columbia Shine', canActivate: [managers], loadComponent: () => import('./pages/clientes').then((m) => m.Cliente) },
  { path: 'reportes', title: 'Reportes · Columbia Shine', canActivate: [managers], loadComponent: () => import('./pages/reportes').then((m) => m.Reportes) },
  { path: 'ajustes', title: 'Ajustes · Columbia Shine', canActivate: [only('OWNER')], loadComponent: () => import('./pages/ajustes').then((m) => m.Ajustes) },
  { path: 'lavador', title: 'Mis motos · Columbia Shine', canActivate: [only('WASHER')], loadComponent: () => import('./pages/lavador').then((m) => m.Lavador) },
  { path: 'agendar', title: 'Agenda tu lavado · Columbia Shine', canActivate: [only('CLIENT')], loadComponent: () => import('./pages/agenda').then((m) => m.Agendar) },
  { path: '**', redirectTo: '' },
];

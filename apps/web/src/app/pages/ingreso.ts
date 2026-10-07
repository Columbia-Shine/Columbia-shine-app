import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, homeFor, ROLE_NAMES, Session, Toast } from '../core';

/** Ingreso del equipo: PIN en la tablet del local, o correo y contraseña. */
@Component({
  selector: 'app-ingreso',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="page narrow centro">
      <img src="logo.png" alt="Columbia Shine, pasión por tu máquina" width="190" height="183" />
      <div class="row">
        <button class="pastilla" [attr.aria-pressed]="mode() === 'pin'" (click)="mode.set('pin')">Equipo con PIN</button>
        <button class="pastilla" [attr.aria-pressed]="mode() === 'email'" (click)="mode.set('email')">Correo y contraseña</button>
      </div>

      @if (mode() === 'pin') {
        <h1>¿Quién entra?</h1>
        @if (staff().length) {
          <div class="grid-sm ancho">
            @for (s of staff(); track s.id) {
              <button class="opcion persona" [attr.aria-pressed]="selected() === s.id" (click)="pick(s.id)">
                <span>{{ s.name }}</span>
                <span class="chico suave">{{ roles[s.role] }}</span>
              </button>
            }
          </div>
          <div class="puntos" aria-label="PIN de 4 dígitos">
            @for (i of [0, 1, 2, 3]; track i) {
              <span [class.lleno]="i < pin().length"></span>
            }
          </div>
          <div class="teclado ancho">
            @for (k of keys; track $index) {
              @if (k === '') {
                <span></span>
              } @else {
                <button class="tecla" [attr.aria-label]="k === '←' ? 'Borrar' : k" [disabled]="busy()" (click)="press(k)">{{ k }}</button>
              }
            }
          </div>
        } @else {
          <p class="vacio ancho">Todavía no hay equipo con PIN. El propietario entra con correo y contraseña y crea los usuarios en Ajustes.</p>
        }
      } @else {
        <h1>Ingreso</h1>
        <form class="col ancho" (ngSubmit)="loginEmail()">
          <div>
            <label for="email">Correo</label>
            <input id="email" class="campo" type="email" name="email" autocomplete="username" required [(ngModel)]="email" />
          </div>
          <div>
            <label for="password">Contraseña</label>
            <input id="password" class="campo" type="password" name="password" autocomplete="current-password" required [(ngModel)]="password" />
          </div>
          <button class="btn primario grande" [disabled]="busy()">Entrar</button>
        </form>
      }
      <p class="chico suave">¿Eres cliente? <a routerLink="/cliente">Agenda tu lavado aquí</a></p>
    </main>
  `,
  styles: `
    .centro { align-items: center; text-align: center; padding-top: 32px; }
    .ancho { width: 100%; text-align: left; }
    .persona { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 2px; }
    .puntos { display: flex; gap: 14px; }
    .puntos span { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--amarillo); }
    .puntos span.lleno { background: var(--amarillo); }
    .teclado { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .tecla { height: 64px; border-radius: 12px; border: 1px solid var(--gris-medio); background: var(--gris-oscuro); font-size: 24px; font-weight: 700; cursor: pointer; }
    .tecla:active { background: var(--azul-oscuro); }
  `,
})
export class Ingreso {
  private api = inject(Api);
  private session = inject(Session);
  private router = inject(Router);
  private toast = inject(Toast);

  protected roles: Record<string, string> = ROLE_NAMES;
  protected keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '←'];
  protected mode = signal<'pin' | 'email'>('pin');
  protected staff = signal<any[]>([]);
  protected selected = signal('');
  protected pin = signal('');
  protected busy = signal(false);
  protected email = signal('');
  protected password = signal('');

  constructor() {
    const u = this.session.user();
    if (u) {
      this.router.navigateByUrl(homeFor(u.role));
      return;
    }
    this.api.get('/auth/staff').then((s) => {
      this.staff.set(s);
      if (!s.length) this.mode.set('email');
    }, this.toast.fail);
  }

  pick(id: string) {
    this.selected.set(id);
    this.pin.set('');
  }

  press(k: string) {
    if (k === '←') return this.pin.update((p) => p.slice(0, -1));
    if (!this.selected()) return this.toast.show('Primero toca tu nombre.', true);
    this.pin.update((p) => (p + k).slice(0, 4));
    if (this.pin().length === 4) this.enter({ userId: this.selected(), pin: this.pin() });
  }

  loginEmail() {
    this.enter({ email: this.email(), password: this.password() });
  }

  private async enter(body: unknown) {
    this.busy.set(true);
    try {
      const { token, user } = await this.api.post('/auth/login', body);
      this.session.start(token, user);
      this.router.navigateByUrl(homeFor(user.role));
    } catch (e) {
      this.pin.set('');
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Ingreso y registro de clientes, para agendar desde el celular. */
@Component({
  selector: 'app-ingreso-cliente',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="page narrow centro">
      <img src="logo.png" alt="Columbia Shine, pasión por tu máquina" width="170" height="164" />
      <h1>{{ register() ? 'Crea tu cuenta' : 'Agenda tu lavado' }}</h1>
      <form class="col ancho" (ngSubmit)="submit()">
        @if (register()) {
          <div>
            <label for="name">Tu nombre</label>
            <input id="name" class="campo" name="name" autocomplete="name" required [(ngModel)]="name" />
          </div>
        }
        <div>
          <label for="phone">Celular</label>
          <input id="phone" class="campo" name="phone" type="tel" inputmode="numeric" autocomplete="tel" required [(ngModel)]="phone" />
        </div>
        <div>
          <label for="pass">{{ register() ? 'Crea una clave (mínimo 6 caracteres)' : 'Clave' }}</label>
          <input id="pass" class="campo" name="pass" type="password" [autocomplete]="register() ? 'new-password' : 'current-password'" required [(ngModel)]="password" />
        </div>
        <button class="btn primario grande" [disabled]="busy()">{{ register() ? 'Crear cuenta' : 'Entrar' }}</button>
      </form>
      <button class="btn bloque" (click)="register.set(!register())">{{ register() ? 'Ya tengo cuenta' : 'Es mi primera vez: crear cuenta' }}</button>
      <p class="chico suave"><a routerLink="/ingreso">Ingreso del equipo</a></p>
    </main>
  `,
  styles: `
    .centro { align-items: center; text-align: center; padding-top: 32px; }
    .ancho { width: 100%; text-align: left; }
  `,
})
export class IngresoCliente {
  private api = inject(Api);
  private session = inject(Session);
  private router = inject(Router);
  private toast = inject(Toast);

  protected register = signal(false);
  protected busy = signal(false);
  protected name = signal('');
  protected phone = signal('');
  protected password = signal('');

  constructor() {
    const u = this.session.user();
    if (u) this.router.navigateByUrl(homeFor(u.role));
  }

  async submit() {
    this.busy.set(true);
    try {
      const body = { name: this.name(), phone: this.phone(), password: this.password() };
      const { token, user } = await this.api.post(this.register() ? '/auth/register' : '/auth/login', body);
      this.session.start(token, user);
      this.router.navigateByUrl(homeFor(user.role));
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
}

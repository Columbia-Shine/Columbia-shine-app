import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, homeFor, Session, Toast } from '../core';

/** Ingreso del equipo (propietario, administrador, lavador) con usuario y contraseña. */
@Component({
  selector: 'app-ingreso',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="page narrow ingreso">
      <img src="logo.png" alt="Columbia Shine, pasión por tu máquina" width="190" height="183" />
      <h1>Ingreso del equipo</h1>
      <form class="col ancho" (ngSubmit)="submit()">
        <div>
          <label for="login">Usuario</label>
          <input id="login" class="campo" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required [(ngModel)]="login" />
        </div>
        <div>
          <label for="password">Contraseña</label>
          <input id="password" class="campo" type="password" name="password" autocomplete="current-password" required [(ngModel)]="password" />
        </div>
        <button class="btn primario grande" [disabled]="busy()">Entrar</button>
      </form>
      <p class="chico suave">¿Olvidaste tu contraseña? Pídele al propietario que la cambie en Ajustes.</p>
      <p class="chico suave">¿Eres cliente? <a routerLink="/cliente">Agenda tu lavado aquí</a></p>
    </main>
  `,
})
export class Ingreso {
  private api = inject(Api);
  private session = inject(Session);
  private router = inject(Router);
  private toast = inject(Toast);

  protected busy = signal(false);
  protected login = signal('');
  protected password = signal('');

  constructor() {
    const u = this.session.user();
    if (u) this.router.navigateByUrl(homeFor(u.role));
  }

  async submit() {
    this.busy.set(true);
    try {
      const { token, user } = await this.api.post('/auth/login', { login: this.login(), password: this.password(), staff: true });
      this.session.start(token, user);
      this.router.navigateByUrl(homeFor(user.role));
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Ingreso y registro de clientes, para agendar desde el celular. Entran con usuario o correo. */
@Component({
  selector: 'app-ingreso-cliente',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="page narrow ingreso">
      <img src="logo.png" alt="Columbia Shine, pasión por tu máquina" width="170" height="164" />
      <h1>{{ register() ? 'Crea tu cuenta' : 'Agenda tu lavado' }}</h1>
      <form class="col ancho" (ngSubmit)="submit()">
        @if (register()) {
          <div>
            <label for="name">Tu nombre</label>
            <input id="name" class="campo" name="name" autocomplete="name" required [(ngModel)]="name" />
          </div>
          <div>
            <label for="user">Usuario (con este entras)</label>
            <input id="user" class="campo" name="user" autocomplete="username" autocapitalize="none" spellcheck="false" required [(ngModel)]="username" />
          </div>
          <div>
            <label for="email">Correo (opcional, también sirve para entrar)</label>
            <input id="email" class="campo" name="email" type="email" autocomplete="email" [(ngModel)]="email" />
          </div>
          <div>
            <label for="phone">Celular</label>
            <input id="phone" class="campo" name="phone" type="tel" inputmode="numeric" autocomplete="tel" required [(ngModel)]="phone" />
          </div>
        } @else {
          <div>
            <label for="login">Usuario o correo</label>
            <input id="login" class="campo" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required [(ngModel)]="login" />
          </div>
        }
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
})
export class IngresoCliente {
  private api = inject(Api);
  private session = inject(Session);
  private router = inject(Router);
  private toast = inject(Toast);

  protected register = signal(false);
  protected busy = signal(false);
  protected name = signal('');
  protected username = signal('');
  protected email = signal('');
  protected phone = signal('');
  protected login = signal('');
  protected password = signal('');

  constructor() {
    const u = this.session.user();
    if (u) this.router.navigateByUrl(homeFor(u.role));
  }

  async submit() {
    this.busy.set(true);
    try {
      const { token, user } = this.register()
        ? await this.api.post('/auth/register', { name: this.name(), username: this.username(), email: this.email(), phone: this.phone(), password: this.password() })
        : await this.api.post('/auth/login', { login: this.login(), password: this.password() });
      this.session.start(token, user);
      this.router.navigateByUrl(homeFor(user.role));
    } catch (e) {
      this.toast.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
}

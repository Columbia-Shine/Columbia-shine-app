import { Injectable, Pipe, PipeTransform, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export type Role = 'OWNER' | 'ADMIN' | 'WASHER' | 'CLIENT';
export type User = { id: string; name: string; role: Role; customerId: string | null };

const KEY = 'cs-sesion';

export const homeFor = (role: Role): string => (role === 'WASHER' ? '/lavador' : role === 'CLIENT' ? '/agendar' : '/');

export const ROLE_NAMES: Record<Role, string> = {
  OWNER: 'Propietario',
  ADMIN: 'Administrador de turno',
  WASHER: 'Lavador',
  CLIENT: 'Cliente',
};

export const STATUS_NAMES: Record<string, string> = {
  WAITING: 'En espera',
  WASHING: 'En lavado',
  REVIEW: 'En revisión',
  READY: 'Lista para entregar',
  DELIVERED: 'Entregada',
  CANCELLED: 'Cancelada',
};

export const METHOD_NAMES: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  NEQUI: 'Nequi',
  DAVIPLATA: 'Daviplata',
  TRANSFERENCIA: 'Transferencia',
  DATAFONO: 'Datáfono',
};

@Injectable({ providedIn: 'root' })
export class Session {
  readonly user = signal<User | null>(null);
  token = '';

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved?.token && saved?.user) {
        this.token = saved.token;
        this.user.set(saved.user);
      }
    } catch {
      /* sin sesión guardada */
    }
  }

  start(token: string, user: User) {
    this.token = token;
    this.user.set(user);
    try {
      localStorage.setItem(KEY, JSON.stringify({ token, user }));
    } catch {
      /* la sesión vive solo en memoria */
    }
  }

  end() {
    this.token = '';
    this.user.set(null);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nada que borrar */
    }
  }

  is(...roles: Role[]): boolean {
    const u = this.user();
    return !!u && roles.includes(u.role);
  }
}

/** Mensaje breve que aparece abajo de la pantalla. */
@Injectable({ providedIn: 'root' })
export class Toast {
  readonly message = signal<{ text: string; error: boolean } | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(text: string, error = false) {
    clearTimeout(this.timer);
    this.message.set({ text, error });
    this.timer = setTimeout(() => this.message.set(null), error ? 6000 : 3500);
  }

  /** Para usar en un catch: muestra el mensaje que devolvió el servidor. */
  fail = (e: unknown) => this.show(e instanceof Error ? e.message : 'Algo falló. Intenta de nuevo.', true);
}

@Injectable({ providedIn: 'root' })
export class Api {
  private session = inject(Session);
  private router = inject(Router);

  async req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch('/api' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.session.token ? { Authorization: 'Bearer ' + this.session.token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('No hay conexión con el servidor. Revisa el internet.');
    }
    const data = await res.json().catch(() => null);
    if (res.status === 401 && this.session.token) {
      this.session.end();
      this.router.navigateByUrl('/ingreso');
    }
    if (!res.ok) throw new Error(data?.error || 'Algo falló. Intenta de nuevo.');
    return data as T;
  }

  get = <T = any>(path: string) => this.req<T>('GET', path);
  post = <T = any>(path: string, body?: unknown) => this.req<T>('POST', path, body ?? {});
  patch = <T = any>(path: string, body: unknown) => this.req<T>('PATCH', path, body);
  del = <T = any>(path: string) => this.req<T>('DELETE', path);
}

/** Deja pasar solo a los roles indicados; a los demás los manda a su pantalla de inicio. */
export const only = (...roles: Role[]): CanActivateFn => () => {
  const session = inject(Session);
  const router = inject(Router);
  const u = session.user();
  if (!u) return router.parseUrl(roles.length === 1 && roles[0] === 'CLIENT' ? '/cliente' : '/ingreso');
  return roles.includes(u.role) ? true : router.parseUrl(homeFor(u.role));
};

const pesos = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
export const money = (n: unknown): string => {
  const v = Number(n) || 0;
  return (v < 0 ? '−$' : '$') + pesos.format(Math.abs(v));
};

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform = money;
}

const TZ = 'America/Bogota';
const fmt = {
  hora: new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }),
  dia: new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }),
  fecha: new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }),
};

/** Fechas siempre en hora de Colombia: 'hora', 'dia', 'fecha' o 'completa'. */
@Pipe({ name: 'cuando' })
export class WhenPipe implements PipeTransform {
  transform(value: string | null | undefined, kind: 'hora' | 'dia' | 'fecha' | 'completa' = 'hora'): string {
    if (!value) return '';
    const d = new Date(value);
    if (kind === 'completa') return `${fmt.dia.format(d)}, ${fmt.hora.format(d)}`;
    return fmt[kind].format(d);
  }
}

/** Minutos transcurridos desde una fecha. */
export const minutesSince = (iso: string | null | undefined): number => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);

/** 'YYYY-MM-DD' de hoy (más un desfase en días) en hora de Colombia. */
export const bogotaDay = (offset = 0): string => {
  const d = new Date(Date.now() + offset * 864e5);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
};

export const dayLabel = (day: string): string =>
  new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'));

/** Reduce una foto del celular a un JPEG liviano antes de enviarla. */
export async function shrinkPhoto(file: File, max = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

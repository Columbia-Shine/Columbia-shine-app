import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { one } from './db';

export type Role = 'OWNER' | 'ADMIN' | 'WASHER' | 'CLIENT';
export type SessionUser = { id: string; name: string; role: Role; customerId: string | null };

declare module 'express-serve-static-core' {
  interface Request {
    user: SessionUser;
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Corta la petición con un 400 si la condición no se cumple. */
export function need(cond: unknown, message: string, status = 400): asserts cond {
  if (!cond) throw new HttpError(status, message);
}

const secret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'solo-desarrollo');
if (!secret) throw new Error('Falta la variable JWT_SECRET');

export function sign(user: SessionUser): string {
  // El equipo comparte tablet: la sesión dura una jornada. El cliente entra desde su celular.
  return jwt.sign({ sub: user.id }, secret, { expiresIn: user.role === 'CLIENT' ? '30d' : '14h' });
}

/** Exige sesión válida y, si se indican, uno de los roles permitidos. */
export function auth(...roles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    let sub = '';
    try {
      sub = String((jwt.verify(token, secret) as jwt.JwtPayload).sub);
    } catch {
      throw new HttpError(401, 'Tu sesión venció. Vuelve a ingresar.');
    }
    const u = await one('select id, name, role, customer_id, active from users where id = $1', [sub]);
    if (!u || !u.active) throw new HttpError(401, 'Este usuario ya no está activo.');
    if (roles.length && !roles.includes(u.role)) throw new HttpError(403, 'Tu usuario no tiene permiso para hacer esto.');
    req.user = { id: u.id, name: u.name, role: u.role, customerId: u.customer_id };
    next();
  };
}

export const STAFF: Role[] = ['OWNER', 'ADMIN', 'WASHER'];
export const MANAGERS: Role[] = ['OWNER', 'ADMIN'];

export const int = (v: unknown, label: string, min = 0): number => {
  const n = Number(v);
  need(Number.isInteger(n) && n >= min, `${label} no es un valor válido.`);
  return n;
};

export const text = (v: unknown, label: string, max = 200): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  need(s.length > 0, `Falta ${label}.`);
  need(s.length <= max, `${label} es demasiado largo.`);
  return s;
};

export const optText = (v: unknown, max = 500): string | null => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || null;
};

export const normPhone = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
export const normPlate = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

import fs from 'node:fs';
import path from 'node:path';
import { Pool, PoolClient, types } from 'pg';

// bigint (números de orden, sumas) como number: los valores del negocio caben de sobra
types.setTypeParser(20, (v) => Number(v));

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Falta la variable DATABASE_URL');
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || url.includes('host=/');

export const pool = new Pool({
  connectionString: url,
  ssl: local ? undefined : { rejectUnauthorized: false },
  max: 8,
});

export type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

export async function q<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | undefined> {
  return (await q<T>(sql, params, db))[0];
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

export async function audit(userId: string | null, action: string, entity: string, entityId: string | null, detail: unknown = null, db: Db = pool) {
  await db.query('insert into audit_log (user_id, action, entity, entity_id, detail) values ($1, $2, $3, $4, $5)', [
    userId, action, entity, entityId, detail === null ? null : JSON.stringify(detail),
  ]);
}

export async function setting(key: string, fallback: number): Promise<number> {
  const row = await one<{ value: number }>('select value from settings where key = $1', [key]);
  return row ? Number(row.value) : fallback;
}

/** Aplica, en orden, los .sql de db/migrations que aún no se han ejecutado. */
export async function migrate() {
  const dir = path.resolve(__dirname, '../../../db/migrations');
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  await pool.query('alter table schema_migrations enable row level security');
  const done = new Set((await q<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await tx(async (c) => {
      await c.query(sql);
      await c.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    console.log('Migración aplicada:', file);
  }
}

/** Fecha de hoy en Colombia, como 'YYYY-MM-DD'. */
export const TODAY = "(now() at time zone 'America/Bogota')::date";
/** Convierte una columna timestamptz a fecha local de Colombia. */
export const localDate = (col: string) => `(${col} at time zone 'America/Bogota')::date`;

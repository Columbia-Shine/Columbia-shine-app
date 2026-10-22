import { Db, one, pool, TODAY } from './db';

const VALID_PAYMENT = `p.void_status is distinct from 'APPROVED'`;

/** Membresía vigente de una moto con sus lavados usados y restantes (o null). */
export async function activeMembership(bikeId: string, db: Db = pool) {
  const m = await one(
    `select m.id, m.name, m.service_id, s.name as service_name, m.washes, m.price, m.starts_on::text, m.ends_on::text,
       (select count(*) from payments p join orders o on o.id = p.order_id
          where o.membership_id = m.id and p.covered > 0 and ${VALID_PAYMENT})::int as used
     from memberships m join services s on s.id = m.service_id
     where m.bike_id = $1 and m.cancelled_at is null and ${TODAY} between m.starts_on and m.ends_on
     order by m.created_at desc limit 1`,
    [bikeId],
    db,
  );
  if (!m) return null;
  return { ...m, remaining: Math.max(0, m.washes - m.used) };
}

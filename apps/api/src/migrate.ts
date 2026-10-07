import { migrate, pool } from './db';

migrate()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

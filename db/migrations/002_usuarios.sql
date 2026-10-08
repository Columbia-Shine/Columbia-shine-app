-- Ingreso con usuario y contraseña para todos (el PIN deja de usarse).
-- El usuario se guarda en minúsculas; el índice evita repetidos sin importar mayúsculas.
alter table users add column username text;
create unique index users_username_key on users (lower(username));

-- Un propietario creado antes de este cambio entra como "propietario"
update users set username = 'propietario' where role = 'OWNER' and username is null
  and not exists (select 1 from users where lower(username) = 'propietario');

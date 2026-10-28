# Nube

La parte de la app que vive en internet (#253): lo que tiene que funcionar aunque la casa esté
apagada, y a mano desde fuera. La casa (jellycartoon, en la carpeta de arriba) se queda con la
media; la nube habla con ella por sus APIs (`/rest`, `/api/v1`), a través del túnel rathole.

Varias familias en una sola app, cada una aislada por la seguridad por filas de Postgres.

## Cómo está hecha

- El mismo stack que jellycartoon: SvelteKit 3, Svelte 5, Bun, Drizzle, Postgres y Better Auth
  (con verificación en dos pasos).
- **Familias:** todas sus tablas llevan `family_id` y una política de Postgres que solo deja ver y
  tocar las filas de la familia de quien pregunta (`src/lib/server/db/family.schema.ts`). La app
  entra como `nube_app`, un rol que no es el dueño de las tablas, y `withFamily`
  (`src/lib/server/family-scope.ts`) le dice a Postgres, para una transacción, quién pregunta y de
  qué familia. Una consulta que lo olvide no ve nada. Los tests (`family-scope.test.ts`) lo
  comprueban contra un Postgres real en memoria (PGlite).
- **Quién entra:** solo con invitación. `bun run familia "Casa García" ana@example.com` crea la
  familia y la invitación de quien la administra, que crea su cuenta con «Tengo una invitación».
- **La casa:** en Ajustes, la dirección de fuera de jellycartoon (su `MEDIA_HOST`) y la clave de su
  Ajustes → Casa → «La nube». La clave se guarda cifrada y no sale del servidor; cada petición a
  casa va en nombre de la persona, por su email (el mismo en las dos apps).

## Desarrollo

```sh
cd nube
cp .env.example .env          # y un BETTER_AUTH_SECRET
bun install
bun run db:start              # Postgres en 127.0.0.1:5435, con el rol nube_app
bun run familia "Casa de prueba" tu@email
bun run dev                   # migra y arranca
```

Los cambios del esquema, con `bun run db:generate`: nunca SQL a mano.

## Producción (Dokploy en el VPS)

1. **Postgres:** una base de datos en Dokploy. Una vez, como su dueño, el rol de la app (lo mismo
   que `scripts/init-db.sh`, cambiando la contraseña y `<dueño>` por el usuario de Dokploy):
   ```sql
   CREATE ROLE nube_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '…';
   GRANT CONNECT ON DATABASE nube TO nube_app;
   GRANT USAGE ON SCHEMA public TO nube_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE <dueño> IN SCHEMA public
   	GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nube_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE <dueño> IN SCHEMA public
   	GRANT USAGE, SELECT ON SEQUENCES TO nube_app;
   ```
2. **La app:** una aplicación de Dokploy desde este repositorio, con el Dockerfile de `nube/`
   (Build Path `/nube`), el dominio (`nube.<tu-dominio>`) y estas variables:
   - `DATABASE_URL`: como `nube_app`.
   - `MIGRATE_DATABASE_URL`: como el dueño, para las migraciones al arrancar.
   - `ORIGIN`: `https://nube.<tu-dominio>`.
   - `BETTER_AUTH_SECRET`: `openssl rand -base64 32`.
3. **La primera familia:** en la terminal del contenedor,
   `bun scripts/crear-familia.ts "Casa García" ana@example.com`.

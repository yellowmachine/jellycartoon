---
title: 'Producción (Dokploy en el VPS)'
---

Como svelte-thinking: una app **Docker Compose** de Dokploy con `compose.prod.yaml`, Postgres y la
app en la misma pila. La primera vez que arranca Postgres, `scripts/init-db.sh` crea el rol de la
app (`nube_app`) con su contraseña: no hay SQL a mano.

1. **Create Service → Compose**, desde este repositorio, rama `main`, con
   **Compose Path** `./nube/compose.prod.yaml`.
2. **Environment** (contraseñas en hexadecimal, porque van dentro de las URLs:
   `openssl rand -hex 24`):
   ```sh
   POSTGRES_PASSWORD=…
   APP_DB_PASSWORD=…
   ORIGIN=https://seilide.tu-dominio.com
   BETTER_AUTH_SECRET=…          # openssl rand -base64 32
   ADMIN_EMAIL=tu@email          # tu familia y tu invitación, al arrancar
   S3_ACCESS_KEY_ID=…            # el rustfs de la pila (fotos de tickets, facturas): openssl rand -hex 12
   S3_SECRET_ACCESS_KEY=…        # openssl rand -hex 24
   ADMIN_FAMILY="Casa García"
   SMTP_HOST=smtp.protonmail.ch  # los correos («Pedir acceso» de la portada); sin él, no se envían
   SMTP_USER=no-reply@scholio.review
   SMTP_PASS=…                   # el token SMTP de Proton
   ```
   Quien pide acceso desde la portada (`/`) queda apuntado en la tabla `waitlist`, recibe un correo,
   y a `ADMIN_EMAIL` le llega un aviso (responderlo le escribe a esa persona).
3. **Domains:** `seilide.tu-dominio.com` → servicio `app`, puerto 3000, con HTTPS (Let's Encrypt).
   En Cloudflare, un registro `A` `seilide` → IP del VPS, en modo DNS only.
4. **Deploy.** La imagen la construye GitHub (`.github/workflows/nube-image.yml`, #277) en cada push
   a `main` que toque Seilide, y la publica como `ghcr.io/yellowmachine/nube:main`;
   Dokploy solo la baja y la arranca. Al arrancar, la app aplica las migraciones como el dueño.
   Para que se despliegue sola cuando la imagen está lista, sin compilar en el VPS, como
   svelte-thinking y Langua: en Dokploy, en la app Compose de Seilide, **Autodeploy** activado y su
   **webhook** (Deployments) en el secreto de GitHub `DOKPLOY_NUBE_WEBHOOK_URL` (Settings → Secrets
   and variables → Actions). El workflow espera a que la etiqueta sea la imagen nueva y llama al
   webhook. Sin el secreto, solo publica la imagen, y se despliega a mano.
   - Volver a una imagen anterior: `NUBE_TAG=sha-<commit>` en el Environment, y Deploy.
5. **Entrar:** el primer arranque crea la familia de `ADMIN_EMAIL` y deja en el log del servicio
   `app` el enlace de su invitación («crea su cuenta en https://…/invitacion/…»); ábrelo y elige la
   contraseña. La contraseña nunca va en el entorno: un despliegue no la cambia.

Más familias, en la terminal del servicio `app`:
`bun scripts/crear-familia.ts "Casa García" ana@example.com`, que imprime el enlace para pasárselo.

`init-db.sh` solo corre con el volumen de Postgres vacío: cambiar `APP_DB_PASSWORD` después
necesita `ALTER ROLE nube_app PASSWORD '…'` en la base de datos.

## Copias del VPS

Seilide, Langua, Librarian y Scholio, cada noche por el cron de root (#320): `deploy/vps-backup.sh`
sube a un bucket de [R2](https://developers.cloudflare.com/r2/) tres ficheros de cada una, cifrados
con [age](https://age-encryption.org) antes de salir del VPS:

- **La base de datos** (`<app>-<fecha UTC>.dump.age`), volcada con su propio `pg_dump`, en su
  contenedor: su versión, porque uno más nuevo no se restaura limpio en un Postgres más viejo.
- **Su Environment de Dokploy** (`….env.age`): el `.env` que Dokploy deja junto a su compose. Con
  los secretos sin los que la base de datos restaurada no sirve (`BETTER_AUTH_SECRET`).
- **Sus ficheros** (`….files.tar.age`), si tiene: el bucket `nube` del rustfs de Seilide (fotos de
  tickets y de viajes, facturas), el `scholio` del de Scholio y el volumen de los clips de Langua.

Se guardan las 7 últimas noches de cada una. La subida es la imagen de las copias de las casas
(`Dockerfile.backup`, `backup-r2.sh`), en la red de cada app.

Una vez, en Cloudflare, como en [Copia en Cloudflare R2](/tecnica/casa/copias/#copia-en-cloudflare-r2) de la casa: un bucket para el VPS
(no el de una casa: una clave de R2 vale para un bucket entero), su token **Object Read & Write** de
solo ese bucket, su regla de bloqueo de 5 días y una clave de age (`age-keygen -o vps-copias.key`,
entera al gestor de contraseñas).

Y en el VPS, como root, con los dos ficheros de `deploy/` copiados allí:

```sh
install -m 755 vps-backup.sh /usr/local/sbin/vps-backup.sh
install -m 644 vps-backup.cron /etc/cron.d/vps-backup
install -m 600 /dev/null /etc/vps-backup.env
```

En `/etc/vps-backup.env`, sin comillas (lo lee `docker run --env-file`):

```sh
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=vps-copias/backups
BACKUP_AGE_RECIPIENT=age1...
BACKUP_REPORT_URL=https://seilide.app/api/admin/copias
BACKUP_REPORT_TOKEN=...
```

Cada copia, al acabar, bien o mal, avisa a Seilide con las últimas líneas de su salida (lo que
subió y cuánto ocupa, o lo que falló): se ven en **/admin**, solo para ADMIN_EMAIL, en rojo si la
última falló o si una app lleva más de 26 h sin copia buena. `BACKUP_REPORT_TOKEN`, el mismo que en
el Environment de Seilide (`openssl rand -hex 32`). Sin las dos variables no avisa, y si Seilide no
contesta solo se anota en el log: la copia ya está hecha.

Para probarlo ya, una de las líneas de `deploy/vps-backup.cron`:
`vps-backup.sh seilide jellycartoon-nube-nube-98dnxl db s3:rustfs:nube`. El log de cada noche, en
`/var/log/vps-backup.log`. El nombre de cada app es el de su carpeta en `/etc/dokploy/compose`: si se
vuelve a crear una en Dokploy, cambia el suyo en `/etc/cron.d/vps-backup`.

Para leer una copia: `age -d -i vps-copias.key <fichero>.age > <fichero>`. La base de datos se
restaura con el `pg_restore` de su versión (`--clean --if-exists`, como su dueño), y los ficheros se
suben a su bucket con `rclone copy`.

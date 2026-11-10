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
   SMTP_USER=no-reply@seilide.app
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

## Llamadas (coturn)

Las llamadas de la familia (#330) van de navegador a navegador por WebRTC. Seilide solo pone en
contacto a los dos aparatos. Cuando no pueden verse directamente (una tablet con datos móviles,
detrás del NAT de su compañía), el audio pasa por [coturn](https://github.com/coturn/coturn), que
va en la misma pila con la red del host. Seilide le da a cada llamada una contraseña que vale un día
(`use-auth-secret`), así que no hay usuarios que mantener.

Una vez:

1. En Cloudflare, un registro `A` `turn` → IP del VPS, en modo **DNS only** (el proxy de
   Cloudflare no pasa UDP).
2. En el cortafuegos del VPS, abiertos los puertos **3478 UDP y TCP** y el rango **49160-49200
   UDP** (el relé).
3. En el Environment de Dokploy:
   ```sh
   COMPOSE_PROFILES=llamadas
   TURN_HOST=turn.seilide.app
   TURN_SECRET=…                 # openssl rand -hex 32
   ```
   y **Deploy**. Sin `COMPOSE_PROFILES=llamadas` no arranca coturn, y las llamadas solo conectan
   entre aparatos que se ven (la misma red).

coturn no deja pasar audio hacia direcciones privadas (`denied-peer-ip`): nadie puede usarlo para
llegar a los otros contenedores ni a la red del VPS.

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

### Copia antes de desplegar

Un merge a main despliega Seilide solo (`nube-image.yml` → el webhook de Dokploy), migraciones
incluidas. Antes, el workflow hace una copia como la de cada noche (#392): entra por SSH al VPS con
una clave que solo puede lanzar esa copia, y si falla no despliega. Se guarda aparte, como
`seilide-despliegue-<fecha>`, con sus propias 7: así no echan a las de cada noche, que se guardan
por número. En /admin sale como otra, en rojo solo si falló (no por los días sin copia).

Una vez. En tu PC, la clave (sin frase: la usa GitHub):

```sh
ssh-keygen -t ed25519 -N '' -C github-copia-seilide -f copia-seilide
```

En el VPS, como root: un usuario solo para esto, su clave atada a un comando (`restrict`: sin
shell, sin reenvíos, sin terminal, pida lo que pida quien entra) y ese comando, sin contraseña, con
`sudo`:

```sh
useradd --system --create-home --shell /bin/sh copias
install -d -m 700 -o copias -g copias /home/copias/.ssh
printf 'command="sudo -n /usr/local/sbin/vps-backup.sh seilide-despliegue jellycartoon-nube-nube-98dnxl db s3:rustfs:nube",restrict %s\n' \
  "$(cat copia-seilide.pub)" > /home/copias/.ssh/authorized_keys   # copia-seilide.pub, subida antes (scp)
chown copias:copias /home/copias/.ssh/authorized_keys
chmod 600 /home/copias/.ssh/authorized_keys
echo 'copias ALL=(root) NOPASSWD: /usr/local/sbin/vps-backup.sh seilide-despliegue jellycartoon-nube-nube-98dnxl db s3\:rustfs\:nube' \
  > /etc/sudoers.d/copias
chmod 440 /etc/sudoers.d/copias
visudo -cf /etc/sudoers.d/copias
```

Si `sshd_config` tiene `AllowUsers`, añade `copias`; y el SSH del VPS tiene que admitir a GitHub
(sus IP cambian). Desde tu PC, para probarla: `ssh -i copia-seilide copias@<VPS>` hace una copia y
sale.

En GitHub (Settings → Secrets and variables → Actions), junto a `DOKPLOY_NUBE_WEBHOOK_URL`:

- `VPS_BACKUP_SSH_KEY`: el contenido de `copia-seilide` (la privada). Después, bórrala de tu PC.
- `VPS_BACKUP_HOST`: `copias@<IP o nombre del VPS>`.
- `VPS_BACKUP_KNOWN_HOSTS`: lo que da `ssh-keyscan -t ed25519 <IP o nombre del VPS>`, comprobado
  contra la huella del VPS (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, en él).

Sin `VPS_BACKUP_SSH_KEY`, el workflow avisa y despliega como antes: entonces, con migraciones, la
copia a mano antes del merge.

Para leer una copia: `age -d -i vps-copias.key <fichero>.age > <fichero>`. La base de datos se
restaura con el `pg_restore` de su versión (`--clean --if-exists`, como su dueño), y los ficheros se
suben a su bucket con `rclone copy`.

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
   # STORAGE_QUOTA_MB=1024       # lo que puede guardar cada familia (por defecto 1 GB); la de una, en /admin → Espacio
   ADMIN_FAMILY="Casa García"
   SMTP_HOST=smtp.protonmail.ch  # los correos («Pedir acceso» de la portada); sin él, no se envían
   SMTP_USER=no-reply@seilide.app
   SMTP_PASS=…                   # el token SMTP de Proton
   # SMTP_PORT=587               # 587 con STARTTLS (por defecto); 465 con SMTP_SECURE=true
   # EMAIL_FROM="Seilide <no-reply@seilide.app>"   # quién manda los correos (por defecto, este)
   ```

   Quien pide acceso desde la portada (`/`) queda apuntado en la tabla `waitlist`, recibe un correo,
   y a `ADMIN_EMAIL` le llega un aviso (responderlo le escribe a esa persona). Sin `SMTP_HOST` no
   se manda ningún correo: solo salen en el log.

   Y las variables del KMS, en [Las claves de cada familia (KMS)](#las-claves-de-cada-familia-kms).

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

## Las claves de cada familia (KMS)

Lo que cada familia le da a Seilide y no puede salir de él (#326): su clave de OpenRouter y la de
openrouteservice, la clave de su casa, el token de su bot de Telegram y la credencial con la que
entra cada peque (no tienen contraseña). Se guarda cifrado con una **clave de datos de la familia**, y esa clave, a su vez, la
envuelve [Scaleway Key Manager](https://www.scaleway.com/en/docs/key-manager/) (cifrado de sobre,
`src/lib/server/family-secret.ts` y `envelope.ts`). En la base de datos solo está envuelta
(`family_data_key`), atada a su familia, y cada secreto lleva delante `kms1.`.

Así, **una copia de la base de datos con su `.env` no basta** para leerlos: además hay que poder
pedirle a Key Manager que desenvuelva la clave, y Key Manager solo contesta a la IP del VPS. Seilide
guarda en memoria la clave desenvuelta de cada familia 10 minutos, para no llamar a Scaleway en cada
orden de voz.

Sin las tres variables `SCW_*`, Seilide cifra como antes, solo con `BETTER_AUTH_SECRET`
(`secret-box.ts`): así funcionan el desarrollo, los tests y cualquier otra instalación. Las casas
no usan el KMS nunca, porque tienen que funcionar sin internet.

Una vez, en la [consola de Scaleway](https://console.scaleway.com):

1. **Key Manager → crear una clave** simétrica (AES-256-GCM) en `fr-par`, para cifrar y descifrar.
   Su ID va en `SCW_KMS_KEY_ID`.
2. **IAM → una aplicación solo para Seilide**, con una política que le dé **solo** los permisos de
   Key Manager y una
   [condición por petición](https://www.scaleway.com/en/docs/iam/reference-content/understanding-request-level-conditions/):
   `inIpRange(request.ip, "<IP del VPS>/32")`. Basta con que _una_ política le dé acceso para que
   valga, así que esa aplicación no puede tener ninguna otra sin la condición.
3. **Una clave de API de esa aplicación**, que va en el Environment de Dokploy:
   ```sh
   SCW_ACCESS_KEY=SCW…
   SCW_SECRET_KEY=…
   SCW_KMS_KEY_ID=…
   # SCW_DEFAULT_REGION=fr-par   # por defecto
   ```
   Va en el `.env` como las demás, y por eso también en la copia de cada noche. No pasa nada: la
   copia va cifrada con age, y fuera del VPS la clave no sirve por la condición de IP.
4. **Deploy.** Al arrancar, Seilide comprueba que Key Manager envuelve y desenvuelve bien
   (`[kms] Key Manager responde` en el log) y vuelve a guardar con él lo que estaba cifrado sin el
   KMS (`kms-migrate.ts`). Lo ya pasado no se toca, así que arrancar otra vez no hace nada más. Si
   Key Manager no contesta bien, no pasa nada al KMS y lo dice en el log.

**Una vez puesto, no se puede quitar:** lo guardado con el KMS no se lee sin él. Lo que hay que
tener en cuenta:

- **Restaurar en otro VPS** (otra IP): cambiar la IP de la condición en la política de IAM antes de
  arrancar, o Seilide no podrá leer los secretos.
- **Si se pierde la clave de Key Manager o la cuenta de Scaleway**, los secretos ya no se pueden
  leer. Cada familia tiene que volver a poner los suyos en Ajustes: las claves de OpenRouter y de
  openrouteservice (se crean otras en sus webs), la de su casa y su bot de Telegram. Los peques,
  que entran con una credencial que solo sabe el servidor, no pueden entrar con la guardada. Lo
  demás de la base de datos no se pierde.
- **Botón de emergencia:** revocando la clave de API de la aplicación de IAM, ninguna copia de la
  base de datos sirve para leer los secretos, tampoco desde el VPS, hasta que se cree otra.
- **Key Manager caído:** las familias sin su clave en la memoria de Seilide se quedan sin IA (ni
  nada que use un secreto) hasta que vuelva.

El KMS no protege si alguien controla la app en marcha (root en el VPS), porque puede pedirle a
Key Manager lo mismo que ella. Para eso está el límite de crédito en cada clave de OpenRouter.

## Ficheros de las familias: cuota y almacenamiento propio

Las fotos, notas de voz, tickets, facturas y papeles de cada familia van al rustfs de la pila
(bucket `nube`, `familias/<id>/…`), con una cuota por familia: `STORAGE_QUOTA_MB` (1 GB por
defecto) y la de cada una en **/admin → Espacio**. Las frases de espera de los satélites no cuentan.
Al arrancar, Seilide cuadra lo que tiene apuntado con lo que hay en el bucket.

Una familia puede pasar sus ficheros a **su propio S3** (Cloudflare R2, Backblaze B2, AWS,
Scaleway, un MinIO…) desde **Ajustes → Familia → Espacio**: entonces no tiene cuota. Las claves se
guardan cifradas como sus otros secretos. El paso:

- Solo de ida para la familia: puede pasar a otro almacenamiento suyo, pero no volver al de Seilide.
  Si se queda tirada, **/admin → Espacio → Devolver a Seilide** lo hace.
- Mientras se pasa, todo sigue funcionando: se escribe en los dos sitios y se lee del de antes. La
  copia salta lo que ya está, así que tras un reinicio sigue sola desde donde iba; si su bucket
  falla, se para con el motivo y la familia le da a «Seguir».
- Al acabar, la copia en el rustfs de Seilide se borra a los 7 días.
- Solo se llega a direcciones `https://` públicas: nunca a una IP privada, `localhost` ni a los
  contenedores de la pila.
- Si se borra la familia, lo que haya en su bucket no se toca.

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

---
title: 'Copia de seguridad'
---

Qué hay que guardar:

- **Base de datos**: usuarios, progreso, listas, títulos y numeración cambiados a mano. Se copia
  con [`pg_dump`](https://www.postgresql.org/docs/current/app-pgdump.html), no copiando el
  volumen.
- **`HOST_DATA_DIR`**: los vídeos convertidos y las miniaturas. Va con la base de datos (cada
  episodio es `hls/<id>`). Con `DELETE_SOURCES=true` es la única copia de los vídeos.
- **`.env`**: la configuración y las claves (`BETTER_AUTH_SECRET`, la de Cloudflare, las de R2…).
  Guárdalo en tu gestor de contraseñas, como nota segura. Nunca en git, ni en una nube sin cifrado de
  extremo a extremo. Perderlo no es grave (las claves se pueden volver a crear); que se filtre, sí: si
  pasa, cambia las de Cloudflare, R2 y OpenRouter, `WUD_PASSWORD` y `BETTER_AUTH_SECRET`.
- **`HOST_MEDIA_DIR`**, opcional: los originales. Con ellos se puede regenerar `HOST_DATA_DIR`,
  pero son horas de conversión.

`scripts/backup.sh` lo hace todo, con la app en marcha. Ejecútalo desde la carpeta de
`compose.prod.yaml` y `.env` (necesita `jq` y `rsync`). Un HDD externo va bien: tras la primera
copia, `rsync` solo copia lo nuevo. La carpeta de destino tiene que existir ya (créala una vez en
el disco de la copia), así que con el disco desconectado no copia nada al disco interno; tampoco
copia al mismo disco que `HOST_DATA_DIR`:

```sh
scripts/backup.sh /ruta/del/backup            # base de datos, convertidos y .env
scripts/backup.sh --media /ruta/del/backup    # además, los originales
```

Deja `jellycartoon.dump`, `data/`, `.env` y, con `--media`, `media/`. Las carpetas son un espejo:
cada copia sustituye a la anterior en el mismo destino. Primero hace el volcado y luego copia
los ficheros; un episodio que termine de convertirse entre medias se volvería a convertir al
restaurar, pero nunca queda uno listo sin sus ficheros.

Para restaurar, con el `.env` de la copia en su sitio y las carpetas de `HOST_DATA_DIR` (y
`HOST_MEDIA_DIR`) vueltas a copiar:

```sh
docker compose -f compose.prod.yaml up -d db
docker compose -f compose.prod.yaml exec -T db \
  pg_restore -U jellycartoon -d jellycartoon --clean --if-exists --no-owner < /ruta/del/backup/jellycartoon.dump
docker compose -f compose.prod.yaml up -d
```

La app aplica al arrancar las migraciones posteriores a la copia.

## Copia en Cloudflare R2

Con el perfil `backup`, cada noche se sube la base de datos a un bucket de
[R2](https://developers.cloudflare.com/r2/). Antes de salir del equipo se cifra con
[age](https://age-encryption.org): el servidor solo tiene la clave pública, que cifra pero no
descifra, y la privada la guardas tú aparte. Solo va la base de datos (unos MB), no los vídeos; la
copia completa sigue siendo `scripts/backup.sh`.

Una vez, en Cloudflare (R2 en el panel):

1. **Crea un bucket**, por ejemplo `jellycartoon`, con location **Automatic** (no una jurisdicción
   como la UE, que usa otra dirección) y storage class **Standard**: es la que entra en la capa
   gratuita, y Infrequent Access cobra cada descarga y un mínimo de 30 días por fichero.
2. **R2 → Manage API tokens → Create API token**, con el permiso **Object Read & Write** y solo
   **ese bucket**. Apunta el _Access Key ID_, el _Secret Access Key_ y el _Account ID_.
3. **En el bucket, Settings → Bucket lock rules** ([bloqueo](https://developers.cloudflare.com/r2/buckets/bucket-locks/)):
   una regla de 5 días para el prefijo `backups/`. Como el token también puede borrar, así nadie que
   lo tenga borra las copias recientes.

Cada bucket, de una sola casa: una clave de R2 vale para el bucket entero, y con uno compartido una
casa podría borrar las copias de otra. Tras cada copia se borran las de antes de las 7 últimas noches
(`BACKUP_KEEP`): por número y no por fecha, para que si las copias dejan de subir no se vayan también
las últimas buenas.

En tu ordenador, la clave para cifrar (`age-keygen` viene con [age](https://github.com/FiloSottile/age)):

```sh
age-keygen -o jellycartoon-copias.key
```

Guarda el fichero entero en tu gestor de contraseñas: sin él no se pueden leer las copias. La línea
`# public key: age1…` es la que va en el `.env`:

```sh
COMPOSE_PROFILES="updates,backup"   # los que uses, separados por comas
R2_ACCOUNT_ID="..."
R2_ACCESS_KEY_ID="..."
R2_SECRET_ACCESS_KEY="..."
R2_BUCKET="jellycartoon/backups"      # bucket y carpeta (prefijo): aparece sola con la primera copia
BACKUP_AGE_RECIPIENT="age1..."
# BACKUP_TIME="03:30"               # a qué hora (la de TZ)
# BACKUP_KEEP="7"                   # cuántas noches se guardan
```

Las claves de R2 van, como el resto del `.env`, en el gestor de contraseñas; la de age también, en
la misma nota o en otra.

Para probarla sin esperar a la noche:

```sh
docker compose -f compose.prod.yaml up -d
docker compose -f compose.prod.yaml run --rm backup now
```

La copia aparece en el bucket como `backups/jellycartoon-<fecha UTC>.dump.age`. Si una noche no se sube,
`docker compose -f compose.prod.yaml ps backup` la muestra _unhealthy_ al día siguiente, y
`logs backup` dice por qué. Para restaurar, descarga la copia desde el panel de R2, descífrala y
sigue los pasos de arriba con el fichero que sale:

```sh
age -d -i jellycartoon-copias.key jellycartoon-<fecha>.dump.age > jellycartoon.dump
```

Si una copia falla y el log no basta, esto enseña cada petición a R2 y su respuesta, sin claves ni
firmas:

```sh
docker compose -f compose.prod.yaml run --rm -e RCLONE_DUMP=headers -e RCLONE_VERBOSE=2 backup now 2>&1 \
  | grep -E ': (PUT|POST|GET|HEAD|DELETE) |: HTTP/1|Subida|Attempt'
```

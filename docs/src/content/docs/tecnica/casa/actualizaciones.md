---
title: 'Actualizaciones'
---

Con el perfil `updates`, [WUD (What's Up Docker)](https://github.com/getwud/wud) instala cada versión
nueva del canal `stable`: de madrugada, o cuando el administrador lo pide desde la app. En el `.env`:

```sh
COMPOSE_PROFILES="updates"        # o "snapcast,updates"
WUD_PASSWORD="..."                # contraseña del usuario admin de WUD; sin «:»
# UPDATE_CRON="0 4 * * *"         # cuándo mira si hay versión nueva (por defecto, a las 4:00)
```

- **El aviso:** la app compara su versión con el último release de GitHub. Al administrador le sale
  un aviso arriba y, en Ajustes → Versión, las novedades y el botón «Actualizar ahora».
- **Antes de actualizar**, WUD hace una copia de la base de datos en `update-backups/`, junto al
  compose, con la hora en UTC en el nombre, y guarda las cuatro últimas. Si la copia falla, no
  actualiza.
- **Si la versión nueva no arranca sana**, vuelve a la anterior. Para deshacer una actualización
  que sí arrancó, con la imagen anterior (`IMAGE_TAG=1.1.0`) y esa copia: el `pg_restore` de
  arriba con el fichero de `update-backups/`, y `up -d`.
- **Solo toca** los servicios con la etiqueta `wud.watch=true` (la app, Caddy, Snapcast y la copia en
  R2), nunca Postgres. Su web está en `http://127.0.0.1:3001`, solo en el propio equipo.
- **Control de Docker:** WUD necesita el socket de Docker, así que quien controla WUD controla los
  contenedores del equipo. Por eso su web no sale del equipo y lleva contraseña.
- **Limitación:** después de una vuelta atrás, WUD deja de seguir a la app, porque la imagen
  anterior se queda sin la etiqueta `stable`. Hasta el próximo
  `docker compose -f compose.prod.yaml pull` y `up -d` hechos a mano, no se actualiza sola.

## Publicar una versión

1. **PR de `development` a `main`**, y merge. Solo se puede con el CI en verde (`.github/workflows/ci.yml`:
   Prettier, `svelte-check`, tests, build y que no falte ninguna migración); también corre en cada
   push a `development`.
2. **Un release en GitHub sobre `main`**, con la versión como `vX.Y.Z` (tres números): _patch_ para
   arreglos, _minor_ para novedades, _major_ si algo deja de funcionar como antes. Las notas, en
   español: son las que ve el administrador en el aviso de la app. No lo marques como _pre-release_,
   o no mueve `stable`. Desde la web (Releases → Draft a new release) o con:

   ```sh
   gh release create v1.2.0 --target main --title "1.2.0" --notes "…"
   ```

3. **Espera a que Actions construya las imágenes** (unos minutos). Desde ahí, WUD las instala esa
   madrugada, o el administrador con «Actualizar ahora». Cuando terminan (o fallan) llega un aviso a
   Slack, por el _Incoming Webhook_ del secreto `SLACK_WEBHOOK_URL` del repositorio.

WUD actualiza las imágenes, nunca `compose.prod.yaml` ni el `.env`. Si un cambio necesita tocarlos,
dilo en las notas («requiere actualizar el compose»): en cada casa hay que traer el compose nuevo
(`git pull`), completar el `.env` y hacer `pull` y `up -d`.

Una imagen nueva (como lo fue `-backup`) puede quedar privada en GitHub la primera vez. Si `pull`
dice _denied_, en GitHub: Packages → la imagen → Package settings → Change visibility → Public.

# Dozzle en el VPS

Los registros de los contenedores del VPS en una página, y **avisos cuando uno se cae o escribe un
error** (Seilide, Langua, Librarian, Scholio…). Dokploy solo avisa de despliegues, copias y del
propio servidor, no de los errores de una app ni de un contenedor que se cae.

Va con un _socket proxy_: Dozzle no toca el socket de Docker, solo puede listar contenedores, leer
sus registros y eventos (`compose.yaml`).

## Instalarlo

Se entra **con tu cuenta de Seilide** (y su verificación en dos pasos, si la tienes puesta: actívala
en Seilide si no), o con la contraseña de `users.yml` si Seilide no contesta. `users.yml` decide
quién entra: aunque alguien tenga cuenta en Seilide, si su correo no está ahí, no entra.

1. **El dominio** de Dozzle, `monitor.seilide.app`: en el DNS, un registro A a la IP del VPS, la
   misma que `seilide.app` (no hay comodín: sin él, no resuelve). Antes de seguir,
   `dig +short monitor.seilide.app` tiene que dar esa IP.
2. **En Seilide, /admin → Apps → nueva app**: nombre `Dozzle`, dirección de vuelta
   `https://monitor.seilide.app/api/auth/callback` (exacta, con `https`), sin
   marcar «Es para familias». Enseña su identificador y su secreto **una sola vez**: cópialos.
3. **Su carpeta y su usuario**, en el VPS como root, con **el mismo correo que tu cuenta de
   Seilide** (Dozzle os empareja por él). La contraseña la pide sin que quede en el historial:

   ```sh
   mkdir -p /srv/dozzle
   docker run -it --rm amir20/dozzle:v11.3.5 generate admin --name "Miguel" --email tu@correo > /srv/dozzle/users.yml
   chmod 600 /srv/dozzle/users.yml
   ```

4. **En Dokploy**, un proyecto nuevo → **Compose** → proveedor **GitHub**: repositorio
   `yellowmachine/jellycartoon`, rama `main`, **Compose Path** `./deploy/dozzle/compose.yaml`. Si
   quieres que se despliegue solo, **Trigger Type** «On push» y en **Watch Paths**
   `deploy/dozzle/**` (si no, se desplegaría con cada push de la app).
5. **Environment**:

   ```sh
   DOZZLE_OIDC_CLIENT_ID=…       # los de Seilide, del paso 2
   DOZZLE_OIDC_CLIENT_SECRET=…
   SLACK_WEBHOOK_URL=…           # el Incoming Webhook de Slack para los avisos
   ```

   Sin los dos de Seilide, el despliegue se para y dice cuál falta.

6. **Domains**: el dominio del paso 1, servicio `dozzle`, puerto `8080`, con HTTPS.
7. **Deploy**, y entra: tiene que pedir entrar, con el botón **Seilide** y con contraseña. Si entra
   sin pedir nada, páralo: estaría abierto.

Si «Seilide» falla al volver (un error de dirección de vuelta), la de /admin → Apps no es exactamente
`https://<tu dominio>/api/auth/callback`, o el proxy no le dice a Dozzle que va por `https`.

## Los avisos

En Dozzle, **Notifications**:

1. **Add Destination** → Webhook, plantilla **Slack**, URL `${SLACK_WEBHOOK_URL}` (tal cual: la lee de
   su entorno al mandar). **Test** antes de guardar.
2. **Add Alert**, una por cada una de estas. El nombre del contenedor de Seilide es el que enseña
   Dozzle en su lista (en Dokploy suele llevar el nombre del proyecto): pon el tuyo donde dice
   `seilide`. El editor enseña qué contenedores y qué líneas encajan antes de guardar.

| Aviso                    | Contenedor                | Tipo   | Expresión                                                                           |
| ------------------------ | ------------------------- | ------ | ----------------------------------------------------------------------------------- |
| Seilide se ha caído      | `name contains "seilide"` | Evento | `name == "die"`                                                                     |
| Seilide no está sano     | `name contains "seilide"` | Evento | `name == "health_status" && attributes["healthStatus"] == "unhealthy"`              |
| Errores de Seilide       | `name contains "seilide"` | Log    | `message matches "OpenRouter dice 4\|^error$\|^Redirect \\{\|No se pudieron mirar"` |
| Cualquiera muere sin más | `true`                    | Evento | `name == "oom"`                                                                     |

- **«Errores de Seilide»** son los de su registro de hoy: un 401/402 de OpenRouter (sin saldo, o
  demasiadas peticiones a la vez), y una caída como la del 2026-10-31 (`error`, `Redirect {`,
  y luego `Bun v…` al volver). Las alertas de registro de Dozzle no esperan entre avisos: diez
  errores seguidos son diez mensajes. Si molesta, se afina la expresión.
- Una caída también llega como **Seilide se ha caído**, aunque la app no haya podido escribir nada.

## Actualizarlo

Las versiones están fijas en `compose.yaml`. Para subirlas, cambia la etiqueta (las de Dozzle:
https://github.com/amir20/dozzle/releases) y **Deploy** en Dokploy. Lo de `/srv/dozzle` se queda.

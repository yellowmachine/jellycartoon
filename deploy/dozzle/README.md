# Dozzle en el VPS

Los registros de los contenedores del VPS en una página, y **avisos cuando uno se cae o escribe un
error** (Seilide, Langua, Librarian, Scholio…). Dokploy solo avisa de despliegues, copias y del
propio servidor, no de los errores de una app ni de un contenedor que se cae.

Va con un _socket proxy_: Dozzle no toca el socket de Docker, solo puede listar contenedores, leer
sus registros y eventos (`compose.yaml`).

## Instalarlo

1. **Su carpeta y su usuario**, en el VPS como root. La contraseña la pide sin que quede en el
   historial:

   ```sh
   mkdir -p /srv/dozzle
   docker run -it --rm amir20/dozzle:v11.3.5 generate admin --name "Miguel" > /srv/dozzle/users.yml
   chmod 600 /srv/dozzle/users.yml
   ```

2. **En Dokploy**, un proyecto nuevo → **Compose** → proveedor **Raw**, con el contenido de
   `compose.yaml`.
3. **Environment**: `SLACK_WEBHOOK_URL=` con el _Incoming Webhook_ de Slack donde quieras los avisos
   (el mismo canal que el de las releases sirve).
4. **Domains**: el dominio que quieras (p. ej. `registros.seilide.app`), servicio `dozzle`, puerto
   `8080`, con HTTPS.
5. **Deploy**, y entra: tiene que pedir usuario y contraseña. Si no la pide, páralo: estaría abierto.

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

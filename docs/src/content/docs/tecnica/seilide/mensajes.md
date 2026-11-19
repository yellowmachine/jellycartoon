---
title: Mensajes (#551)
description: Mensajería propia de la familia, cifrada de extremo a extremo con MLS (ts-mls) en cada aparato; Seilide solo reparte.
---

Mensajes de la familia cifrados de extremo a extremo con **MLS** (RFC 9420), con
[ts-mls](https://github.com/LukaJCB/ts-mls) 1.6.4 (suite `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`)
en cada aparato. Sustituye a Telegram (#549), que necesitaba la casa. Decisiones y prototipo en #551.

## El servidor: solo reparte (`messages-scope.ts`)

Seilide hace de _delivery service_ de MLS. Tablas (`messages.schema.ts`), todas con la RLS por familia
de siempre; una conversación con una familia vinculada estará en las dos, con el mismo id:

- `msg_device`: los aparatos de cada persona con mensajes activados; su identidad MLS es
  `<userId>/<deviceId>`. `revoked_at`: perdido o quitado.
- `msg_key_package`: los _key packages_ públicos de cada aparato; cada uno se usa una vez para
  añadirlo a un grupo (`claimKeyPackages`).
- `msg_conversation` (+ `msg_member`): la de la familia (`familia-<familyId>`) y, más adelante, las de
  dos personas. `epoch` cuenta los cambios del grupo: **un commit por época** (`postCommit`, con
  `select … for update`); el que llega tarde recibe `ok: false` y se pone al día.
- `msg_event`: la cola, en orden (`welcome` para los aparatos que añade, `commit` y `app` para todos).
  Todo cifrado por los aparatos; el servidor solo sabe quién manda qué a qué conversación y cuándo.

Rutas: `POST /api/mensajes` (`action`: `aparato`, `familia`, `conversacion`, `llaves`, `cambio`,
`enviar`, `quitar`), `GET /api/mensajes?aparato=&desde=` (lo que no ha leído) y `GET /api/mensajes/vivo`
(SSE: «hay algo nuevo», sin contenido). Un mensaje avisa por push a los demás: «💬 Miguel · Mensaje
nuevo», nunca qué dice.

## El aparato (`lib/mensajes/`)

- `messenger.ts`: el núcleo, sin navegador (se prueba en Bun): llaves del aparato (una de firma fija y
  20 _key packages_, repuestos al bajar de 8), grupos, sincronización y envío. Cualquier aparato de
  la conversación compara el grupo con los aparatos que dice el servidor y **añade los nuevos y quita
  los revocados** (`#reconcile`). Nadie hace el grupo de la familia hasta que hay dos: el primero
  tiene uno solo suyo (época 0), y el commit que gane en la época 0 es el de la conversación.
- Comprobación de identidades (`authService`): solo entran en un grupo los aparatos que el servidor
  dice que son de esa conversación (comparar códigos entre móviles, más adelante).
- Quién escribe: va dentro del mensaje cifrado y tiene que coincidir con el aparato que el servidor
  vio enviarlo (por su sesión). ts-mls 1.6.4 no da el remitente de un mensaje de aplicación; con la 2.0,
  el de MLS.
- `idb-store.ts`: llaves, grupos e historial descifrado en IndexedDB, una base por persona.
- `client.svelte.ts` y `/mensajes`: la página (sin SSR).

## Pendiente (#551)

Copia con PIN de 6 cifras (OPRF con límite de intentos y la llave del servidor sellada con el KMS),
enlazar un aparato nuevo con uno que ya tienes, quitar aparatos desde Ajustes, conversaciones de dos
personas y con familias vinculadas, audios, notificación descifrada en el service worker, voz y modo
carretera, y quitar Telegram.

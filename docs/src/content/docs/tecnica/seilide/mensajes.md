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
- `msg_conversation` (+ `msg_member`): la de la familia (`familia-<familyId>`) y las de dos personas
  (`pareja-<a>-<b>`, ordenados): de la misma familia, o de dos vinculadas (#464), guardada en las dos
  familias con el mismo id (`linked_family_id`, la otra) y la época en una sola (`home_family_id`).
  Con quién se puede: lo mismo que se puede llamar (`calls.callable`, `PartnerOf`), comprobado de
  nuevo antes de cada cambio o mensaje (desvincularse corta la conversación). `epoch` cuenta los cambios del grupo: **un commit por época** (`postCommit`, con
  `select … for update`); el que llega tarde recibe `ok: false` y se pone al día.
- `msg_event`: la cola, en orden (`welcome` para los aparatos que añade, `commit` y `app` para todos).
  Todo cifrado por los aparatos; el servidor solo sabe quién manda qué a qué conversación y cuándo.

**Orden de la cola**: cada cola se escribe con el cerrojo de su familia (`pg_advisory_xact_lock`), así
que sus ids van en el orden en que se confirman y ningún aparato lee más allá de uno que se está
escribiendo. Un evento de una conversación con familia vinculada se escribe en las dos colas en la
misma transacción, con los cerrojos tomados siempre en el mismo orden.

Rutas: `POST /api/mensajes` (`action`: `aparato`, `familia`, `pareja`, `conversaciones`,
`conversacion`, `llaves`, `cambio`, `enviar`, `quitar`), `GET /api/mensajes?aparato=&desde=` (lo que no ha leído) y `GET /api/mensajes/vivo`
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

## La copia con PIN (`messages-backup-scope.ts`, `lib/mensajes/backup.ts`)

Se copia el historial descifrado de la persona (lo que han leído sus aparatos), no el estado MLS: un
aparato nuevo entra en los grupos como cualquier otro y la copia le da lo de antes.

- **OPRF** (RFC 9497, `@cloudflare/voprf-ts`, P-256): el aparato ciega `seilide-mensajes:<userId>:<PIN>`,
  el servidor lo evalúa con la llave de esa persona (`msg_backup.oprf_key`, sellada con
  `sealFor`, la llave de la familia y el KMS) y el aparato termina la cuenta. Con HKDF salen dos
  llaves: `cifrar` (AES-256-GCM de la copia, no sale del aparato) y `probar`, de la que el servidor
  guarda solo el SHA-256 (`verifier`).
- **Intentos**: cada evaluación es uno; se vuelve a cero al presentar la prueba buena; al décimo
  sin acertar, la copia se borra y la llave OPRF cambia. Solo con la base de datos no se puede probar
  ningún PIN; con el servidor entero y el KMS sí (por eso, 6 cifras o más).
- La copia se pone al día sola (5 s después de algo nuevo): se abre, se junta con lo del aparato y se
  vuelve a guardar, así que ningún aparato borra lo que guardó otro.
- `POST /api/mensajes/copia` (`estado`, `evaluar`, `crear`, `abrir`, `guardar`, `olvidar`).

## Audios

Grabados mientras se mantiene pulsado (`recorder.svelte.ts`, MediaRecorder: Opus en webm, o mp4 en
Safari; 5 min como mucho). El aparato los cifra con una llave AES-256-GCM propia de cada audio, sube
el fichero cifrado (`POST /api/mensajes/archivo`, al almacenamiento de su familia, área `mensajes`, con
su cuota) y manda en el mensaje MLS `{ t: 'audio', file, key, iv, mime, seconds }`: la llave solo la
tienen los de la conversación (y la copia con PIN). `msg_file` dice de qué familia es cada fichero y
de qué conversación; `GET /api/mensajes/archivo/<id>?conversacion=` solo a quien está en ella (con una
familia vinculada, del almacenamiento de quien lo mandó).

## Fotos y ubicación (#555)

- **Foto**: `photo.ts` la dibuja de nuevo en un `canvas` (lado largo de 1600 px como mucho, JPEG al
  82 %), así que no lleva el EXIF de la cámara (posición, modelo); `createImageBitmap` la gira como
  dice la cámara. Se cifra y se sube como un audio (mismo `POST /api/mensajes/archivo`, `msg_file`,
  límite `MAX_FILE_BYTES` de 6 MB) y el mensaje MLS lleva `{ t: 'foto', file, key, iv, mime, width,
height }`. Se descifra al enseñarla (`FotoBurbuja.svelte`).
- **Ubicación**: `navigator.geolocation` una vez, con alta precisión. Va entera dentro del mensaje MLS,
  `{ t: 'ubicacion', lat, lon, accuracy }` (6 decimales, metros redondeados), sin nada más en el
  servidor. Se ve en el mapa propio (`PlacesMap` con `still`, sin arrastrar ni atribución encima: se
  dice debajo), cuyas teselas sirve Seilide, así que nadie más sabe el sitio. «Abrir» lleva a `geo:`
  en Android, Apple Maps en iPhone/Mac y OpenStreetMap en otros, solo si se toca.
- Las dos se ven antes de mandarlas (enviar o cancelar). `describe()` da su texto corto («📷 Foto»,
  «📍 Ubicación») para la lista, la notificación descifrada y la voz («X te manda una foto»).

## Transcripción en el aparato

`transcribe.worker.ts`: Whisper (`onnx-community/whisper-small`, 8 bits, ~240 MB bajados una vez de
Hugging Face y guardados por el navegador) con Transformers.js 4.3.2 en un _worker_, por WASM (el
motor de onnxruntime va en la compilación). `transcriber.svelte.ts` pasa el audio a 16 kHz mono
(`OfflineAudioContext`). Solo al pedirlo («Aa Transcribir»), avisando de la descarga la primera vez.
El texto se guarda junto al audio (`transcript`) y va en la copia con PIN; nunca se manda a nadie.
Elegido frente a `whisper-base` porque base confundía frases enteras en español (probado con espeak:
small acierta, base no).

## Notificación descifrada

El push lleva solo `mensajes: { conversationId }` (y el título «💬 Miguel»). El service worker
(`service-worker/mensajes.ts`) busca las bases `seilide-mensajes-<userId>` del aparato
(`indexedDB.databases()`), sincroniza como la página (aplica los eventos, guarda lo leído, avanza el
cursor) y enseña el último mensaje de otro; en 8 s o si falla, el texto del servidor. Leer un mensaje
MLS gasta su llave, así que página y worker comparten un cerrojo (`lock.ts`, Web Locks API,
`seilide-mensajes-<userId>`): nunca tocan los grupos a la vez y lo que lee uno, el otro lo encuentra
guardado.

## Voz y modo carretera

La petición de voz lleva `messages: { on, pending }` (activados en el aparato, y a quién espera el
«sí» uno grabado), nunca contenido. Herramientas (`command.ts`, solo con `on`): `voice_message` (a
«familia» o a alguien de `calls.callable`), `confirm_voice_message` (con `pending`),
`messages_settings` (leer en voz alta, mandar como audio, texto o los dos) y `read_messages` («pon el
audio» con `audio`). Hacen acciones que ejecuta el aparato (`voice-messages.svelte.ts`): espera a
que la voz termine su respuesta, graba hasta 1,6 s de silencio tras hablar (`recorder.svelte.ts`
`untilSilence`), transcribe en el aparato si va como texto, pide el «sí» y manda; lee en voz alta lo
que llega (modo carretera, interruptor por aparato) y los audios de hasta un minuto los pone tal
cual. `MensajePendiente.svelte`: el grabado esperando, con Enviar y Borrar.

**Enviar con el grupo al día**: el aparato se pone al día antes de cifrar, y el servidor rechaza un
mensaje de una época que el grupo ya dejó (`stale`): el aparato se pone al día, lo cifra otra vez y
lo reenvía. Sin esto, alguien que escribía justo después de que otro activara un aparato mandaba un
mensaje que nadie podía leer.

## Pendiente (#551)

Quitar Telegram.

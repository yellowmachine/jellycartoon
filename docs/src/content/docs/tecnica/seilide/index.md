---
title: 'Seilide, la nube'
description: 'Lo que vive en internet y funciona aunque la casa esté apagada.'
---

La parte de la app que vive en internet (#253): lo que tiene que funcionar aunque la casa esté
apagada, y a mano desde fuera. La casa (jellycartoon, en la carpeta de arriba) se queda con la
media; Seilide habla con ella por sus APIs (`/rest`, `/api/v1`), a través del túnel rathole.

**El túnel es de cada casa**: cada familia pone su rathole en el servidor que quiera ([Las APIs desde fuera, con
rathole](/tecnica/casa/rathole/)) y da en Ajustes su dirección de fuera y su clave.
Seilide no tiene servidor de rathole ni hace de puente para nadie: solo llama a la dirección que cada
familia le dio. El de quien la mantiene es solo para su casa.

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
- **Quién entra:** solo con invitación, un enlace `/invitacion/<token>` que caduca a los 7 días
  (como las de svelte-thinking), mandado por correo; allí se crea la cuenta, o se entra con ella, y
  se acepta (`src/lib/server/invitation-scope.ts`). Una familia pide acceso desde la portada, y
  `ADMIN_EMAIL` se lo da en **Lista de espera** (`/admin/lista-de-espera`, en su menú): le llega un
  enlace para crear su familia, de la que es administrador. El administrador de cada familia invita
  a los suyos en Ajustes → Familia → Invitaciones, y ve el enlace de cada una por si el correo no
  llega. `bun run familia "Casa García" ana@example.com` crea una familia a mano e imprime el enlace.
- **Una sola cuenta (#279):** Seilide es proveedor OpenID Connect de las casas
  (`@better-auth/oauth-provider` + `jwt`, `src/lib/server/auth.ts`); discovery en
  `https://nube…/api/auth/.well-known/openid-configuration`. Cada casa es un cliente de su
  familia, que crea su administrador en Ajustes → Familia → «Entrar en casa con Seilide» con la
  dirección `https://` de la casa: salen `NUBE_URL`, `NUBE_CLIENT_ID` y `NUBE_CLIENT_SECRET` para
  el `.env` de la casa (el secreto, una vez). Sin pantalla de consentimiento; tras la contraseña y
  el segundo paso, `/login` vuelve a la casa (`src/lib/server/oauth-return.ts`). Solo los de la
  familia: a otro no se le da el token (`src/lib/server/oidc.ts`), y el token lleva la familia en
  `https://nube.scholio.review/family`. La casa vuelve a `https://casa…/api/auth/callback/nube`
  (`genericOAuth` de Better Auth, en [Producción](/tecnica/casa/produccion/) de la casa).
- **Las apps con la misma cuenta (#284):** Langua, Librarian… son también clientes del proveedor,
  pero de ninguna familia: los crea `ADMIN_EMAIL` en **Apps** (`/admin/apps`, en su menú), con su
  dirección de vuelta, y salen `SEILIDE_URL`, `SEILIDE_CLIENT_ID` y `SEILIDE_CLIENT_SECRET` para su
  `.env`. Entra cualquiera con cuenta, sin consentimiento. La familia solo va en el token con el
  scope `family`, que solo se permite a las apps «para familias» (Langua sí, Librarian no); a
  alguien sin familia no se le da (`src/lib/server/oidc-claims.ts`). Las de las casas siguen
  llevándola siempre. Las apps piden también `offline_access`, para tener refresh token.
- **La IA de las apps (#284):** `POST /api/ia/v1/chat/completions`, con la forma de OpenAI (la de
  OpenRouter): la app apunta su cliente compatible con OpenAI a `https://nube…/api/ia/v1`, con el
  access token de la persona como clave y su nombre en `X-Title`. Seilide comprueba el token con su
  propio userinfo, que solo da la familia con el scope `family`, y llama a OpenRouter con la clave
  de esa familia, que no sale de Seilide. Con stream o sin él, y cada gasto va a Gastos → IA
  (`src/lib/server/app-ai.ts`, `forwardChat` en `openrouter.ts`).
- **La casa:** en Ajustes, la dirección de fuera de jellycartoon (su `MEDIA_HOST`) y la clave de su
  Ajustes → Casa → «Seilide». La clave se guarda cifrada y no sale del servidor; cada petición a
  casa va en nombre de la persona, por su email (el mismo en las dos apps).

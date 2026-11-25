import { answers } from 'comun/server/subsonic/protocol.ts';
import { APP_VERSION } from '$app/env/private';

/** The Subsonic protocol (comun's), as the house answers it. */
export { ERROR, passwordMatches, plainPassword } from 'comun/server/subsonic/protocol.ts';

export const { ok, failed } = answers('jellycartoon', APP_VERSION);

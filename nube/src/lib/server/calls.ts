import { callHub } from './calls-hub.ts';
import { asFamily, withFamily } from './family.ts';
import { notify } from './push.ts';

/** The calls (#330): the one hub of this server, with the real database and notices. */
export const calls = callHub({ withFamily, asFamily, notify });

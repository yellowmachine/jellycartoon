import { db } from '#lib/server/db/index.ts';
import { shareReader } from './share-scope.ts';

/** Walks shared by link (#434), for the page whoever has the link opens, with no session. */
export const sharedWalks = shareReader(db);

/**
 * The last walk's link opened in this browser (#434, phase 2): if they then ask to come in, it says
 * whose walk brought them. Only readable by the server, a month long.
 */
export const SEEN_SHARE = {
	name: 'paseo_compartido',
	options: { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 }
} as const;

import { db } from '#lib/server/db/index.ts';
import { shareReader } from './share-scope.ts';

/** Walks shared by link (#434), for the page whoever has the link opens, with no session. */
export const sharedWalks = shareReader(db);

import { db } from '../db/index.ts';
import { owntracksScope } from './owntracks-scope.ts';

/** OwnTracks (#593) on the app's database (owntracks-scope.ts). */
export const owntracks = owntracksScope(db);

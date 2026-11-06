import { db } from './db/index.ts';
import { familyJoinScope } from './family-join-scope.ts';

/** A family of one joining another with its invitation (#315; family-join-scope.ts). */
export const familyJoin = familyJoinScope(db);

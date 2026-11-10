import { db } from './db/index.ts';
import { familyLinkScope } from './family-link-scope.ts';

/** Linked families (#464), with the real database. */
export const familyLinks = familyLinkScope(db);

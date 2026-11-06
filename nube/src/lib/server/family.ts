import { db } from './db/index.ts';
import { familyOnlyScope, familyScope, userScope } from './family-scope.ts';

export { NoFamily, type Membership } from './family-scope.ts';

/** A family's rows, for the person asking (family-scope.ts). */
export const withFamily = familyScope(db);

/** A family's rows for its house, by its key: no person (family-scope.ts). */
export const asFamily = familyOnlyScope(db);

/** A person's rows of no family (family-scope.ts). */
export const asUser = userScope(db);

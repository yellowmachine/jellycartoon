import { db } from './db/index.ts';
import { asUser } from './family.ts';
import { today } from './fridge.ts';
import { sectionVisits } from './section-visits-scope.ts';

/** Which sections each person opens (section-visits-scope.ts), with the app's database. */
export const visits = sectionVisits(db, { asUser, today });

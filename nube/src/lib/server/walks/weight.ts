import { db } from '../db/index.ts';
import { weightScope } from './weight-scope.ts';

/** A person's weight on the app's database (weight-scope.ts). */
export const weight = weightScope(db);

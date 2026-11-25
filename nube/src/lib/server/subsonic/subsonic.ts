import { db } from '../db/index.ts';
import { asUser, withFamily } from '../family.ts';
import { secretsOfUser } from '../user-secret.ts';
import { attempts } from './attempts.ts';
import { appPasswords } from './auth.ts';

/** The passwords for music apps (#625) and their failed tries, with the app's database. */
export const musicApps = appPasswords({ db, withFamily, asUser, secrets: secretsOfUser });
export const tries = attempts();

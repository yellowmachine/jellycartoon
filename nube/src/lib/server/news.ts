import { asUser } from './family.ts';
import { readerNews } from './greader.ts';
import { secretsOfUser } from './user-secret.ts';

/** Each person's news reader, by the Google Reader API (greader.ts). */
export const news = readerNews({ asUser, secrets: secretsOfUser });

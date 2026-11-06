import { asUser } from './family.ts';
import { minifluxNews } from './miniflux.ts';
import { secretsOfUser } from './user-secret.ts';

/** Each person's Miniflux (miniflux.ts). */
export const news = minifluxNews({ asUser, secrets: secretsOfUser });

import { and, eq } from 'drizzle-orm';
import { NUBE_CLIENT_ID, NUBE_CLIENT_SECRET, NUBE_URL } from '$app/env/private';
import { isAdmin } from '#lib/server/app-settings.ts';
import { db } from '#lib/server/db/index.ts';
import { account } from '#lib/server/db/schema.ts';
import { isKidAccount } from '#lib/server/kids.ts';

/**
 * «Entrar con la nube» (#279): the family's cloud (nube/) is this house's OpenID provider, with the
 * client its administrator made there (NUBE_*). One account, the cloud's: an adult of the house is
 * the same person by email, and the house's roles stay here.
 */

export const NUBE_PROVIDER = 'nube';

/** The cloud and this house's client in it, when all three are in the `.env`. */
export const nube =
	NUBE_URL && NUBE_CLIENT_ID && NUBE_CLIENT_SECRET
		? { url: NUBE_URL, clientId: NUBE_CLIENT_ID, clientSecret: NUBE_CLIENT_SECRET }
		: null;

/**
 * Just joined to their cloud account: their password here is no longer needed, and goes. Except the
 * administrator's, for when the cloud does not answer, and children's, who do not enter this way.
 * The administrator can still give them a password link from Ajustes.
 */
export async function dropHousePassword(userId: string) {
	if ((await isAdmin(userId)) || (await isKidAccount(userId))) return;
	await db
		.delete(account)
		.where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));
}

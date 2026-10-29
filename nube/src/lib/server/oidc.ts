import { APIError } from 'better-auth/api';
import { NoFamily, withFamily } from './family.ts';

/**
 * The cloud as the houses' OpenID provider (#279, auth.ts): each house is a client of its family's,
 * which says so in its metadata (`familyId`). Only that family's people get in: the ID token is not
 * issued to anyone else, and it carries their family, for the house to see.
 */
export const FAMILY_CLAIM = 'https://nube.scholio.review/family';

async function membershipOf(userId: string) {
	try {
		return await withFamily(userId, async (_, m) => m);
	} catch (error) {
		if (error instanceof NoFamily) return null;
		throw error;
	}
}

const familyOf = async (userId: string) => (await membershipOf(userId))?.familyId ?? null;

/** Its family owns a house's client (`reference_id`): one family's are not another's. */
export const clientReference = async ({ user }: { user?: { id: string } }) =>
	user ? ((await familyOf(user.id)) ?? undefined) : undefined;

/** Only the family's administrator makes, sees or removes its houses' clients. */
export const clientPrivileges = async ({ user }: { user?: { id: string } }) =>
	user ? (await membershipOf(user.id))?.role === 'admin' : false;

/** The ID token's: refused to someone not of the client's family. */
export async function idTokenClaims({
	user,
	metadata
}: {
	user: { id: string };
	metadata?: Record<string, unknown>;
}) {
	const familyId = await familyOf(user.id);
	if (!familyId || (metadata?.familyId && metadata.familyId !== familyId))
		throw new APIError('FORBIDDEN', { message: 'Esta casa es de otra familia' });
	return { [FAMILY_CLAIM]: familyId };
}

/** The userinfo's: their family, as in the ID token. */
export async function userInfoClaims({ user }: { user: { id: string } }) {
	return { [FAMILY_CLAIM]: await familyOf(user.id) };
}

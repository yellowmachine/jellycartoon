import { APIError } from 'better-auth/api';
import { NoFamily, withFamily } from './family.ts';
import { FAMILY_CLAIM, FAMILY_SCOPE, idTokenAnswer } from './oidc-claims.ts';

/**
 * The cloud as OpenID provider (#279, auth.ts): of the houses, each a client of its family's, which
 * says so in its metadata (`familyId`); and of the apps (#284, app-clients.ts), of no family. Who
 * gets in and with what family, in oidc-claims.ts.
 */

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

/** The ID token's: refused to someone not of a house's family, or of none for a families' app. */
export async function idTokenClaims({
	user,
	scopes,
	metadata
}: {
	user: { id: string };
	scopes: string[];
	metadata?: Record<string, unknown>;
}) {
	const answer = idTokenAnswer(await familyOf(user.id), scopes, metadata);
	if (!answer.ok) throw new APIError('FORBIDDEN', { message: answer.message });
	return answer.claims;
}

/** The userinfo's: their family, with the `family` scope (it is not told which client asks). */
export async function userInfoClaims({ user, scopes }: { user: { id: string }; scopes: string[] }) {
	return scopes.includes(FAMILY_SCOPE) ? { [FAMILY_CLAIM]: await familyOf(user.id) } : {};
}

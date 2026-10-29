/**
 * Who gets an ID token from the cloud's OpenID provider, and with what family (oidc.ts): the rules
 * alone, without the database, to test them.
 *
 * Two kinds of clients. A house's is its family's (`familyId` in its metadata): only its people get
 * in, and the token always carries their family. An app's (`app` in its metadata, app-clients.ts:
 * Langua, Librarian) is of no family: anyone with a cloud account gets in, and the family comes only
 * with the `family` scope, which only the apps of families are allowed (Langua, not Librarian).
 */
export const FAMILY_CLAIM = 'https://nube.scholio.review/family';
export const FAMILY_SCOPE = 'family';

export type IdTokenAnswer =
	{ ok: true; claims: Record<string, string> } | { ok: false; message: string };

export function idTokenAnswer(
	familyId: string | null,
	scopes: string[],
	metadata?: Record<string, unknown>
): IdTokenAnswer {
	const houseFamily = typeof metadata?.familyId === 'string' ? metadata.familyId : null;
	if (houseFamily && houseFamily !== familyId)
		return { ok: false, message: 'Esta casa es de otra familia' };
	const wantsFamily = Boolean(houseFamily) || scopes.includes(FAMILY_SCOPE);
	if (!wantsFamily) return { ok: true, claims: {} };
	if (!familyId) return { ok: false, message: 'Esta app es para familias, y no estás en ninguna' };
	return { ok: true, claims: { [FAMILY_CLAIM]: familyId } };
}

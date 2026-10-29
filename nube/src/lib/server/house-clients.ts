import { auth } from './auth.ts';

/**
 * The houses' clients of the cloud's OpenID provider (#279, oidc.ts), made and removed in Ajustes
 * by the family's administrator, with their session: the provider's own endpoints, which keep each
 * family's (clientReference) and let only its administrator (clientPrivileges).
 */
/** Where Better Auth's genericOAuth, at home, gets the answer back: provider id `nube`. */
export const callbackOf = (houseUrl: string) =>
	`${houseUrl.replace(/\/+$/, '')}/api/auth/oauth2/callback/nube`;

/**
 * A house's client, for its family's administrator (their session's headers): trusted (no
 * consent), its family in its metadata for the ID token's check. The secret, shown once.
 */
export async function createHouseClient(headers: Headers, houseUrl: string, familyId: string) {
	const made = await auth.api.adminCreateOAuthClient({
		headers,
		body: {
			client_name: new URL(houseUrl).host,
			redirect_uris: [callbackOf(houseUrl)],
			token_endpoint_auth_method: 'client_secret_basic',
			grant_types: ['authorization_code'],
			response_types: ['code'],
			skip_consent: true,
			metadata: { familyId }
		}
	});
	return { clientId: made.client_id, clientSecret: made.client_secret ?? '' };
}

/** The family's houses' clients (clientReference), for its administrator. */
export async function houseClients(headers: Headers) {
	const clients = await auth.api.getOAuthClients({ headers });
	return (clients ?? []).map((c) => ({
		clientId: c.client_id,
		name: c.client_name ?? c.client_id,
		redirect: c.redirect_uris?.[0] ?? '',
		createdAt: c.client_id_issued_at ? new Date(c.client_id_issued_at * 1000) : null
	}));
}

export const deleteHouseClient = (headers: Headers, clientId: string) =>
	auth.api.deleteOAuthClient({ headers, body: { client_id: clientId } });

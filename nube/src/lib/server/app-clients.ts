import { auth } from './auth.ts';
import { FAMILY_SCOPE } from './oidc-claims.ts';

/**
 * The apps' clients of the cloud's OpenID provider (#284): Langua, Librarian…, made and removed by
 * the service's administrator in /admin/apps, with their session. Trusted (no consent), and of no
 * family (oidc-claims.ts): anyone with an account gets in. Only an app of families may ask for the
 * `family` scope, and with it gets the person's family.
 *
 * The provider files a client under its maker's family (clientReference), so these are under the
 * administrator's, with the houses'; `app` in their metadata sets them apart.
 */
const SCOPES = ['openid', 'profile', 'email'];

/** An app's client, not a house's. */
export const isApp = (c: object) => (c as { app?: unknown }).app === true;

/** An app's client: its secret, shown once. */
export async function createAppClient(
	headers: Headers,
	app: { name: string; redirectUri: string; family: boolean }
) {
	const made = await auth.api.adminCreateOAuthClient({
		headers,
		body: {
			client_name: app.name,
			redirect_uris: [app.redirectUri],
			scope: (app.family ? [...SCOPES, FAMILY_SCOPE] : SCOPES).join(' '),
			token_endpoint_auth_method: 'client_secret_basic',
			grant_types: ['authorization_code'],
			response_types: ['code'],
			skip_consent: true,
			metadata: { app: true }
		}
	});
	return { clientId: made.client_id, clientSecret: made.client_secret ?? '' };
}

/** The apps' clients, for the service's administrator. */
export async function appClients(headers: Headers) {
	const clients = await auth.api.getOAuthClients({ headers });
	return (clients ?? []).filter(isApp).map((c) => ({
		clientId: c.client_id,
		name: c.client_name ?? c.client_id,
		redirect: c.redirect_uris?.[0] ?? '',
		family: (c.scope ?? '').split(' ').includes(FAMILY_SCOPE),
		createdAt: c.client_id_issued_at ? new Date(c.client_id_issued_at * 1000) : null
	}));
}

export const deleteAppClient = (headers: Headers, clientId: string) =>
	auth.api.deleteOAuthClient({ headers, body: { client_id: clientId } });

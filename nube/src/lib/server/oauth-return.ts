/**
 * A house's «Entrar con la nube» (#279): the provider (auth.ts) sends to /login with its query
 * signed, and resumes the authorization when a session is made with that query as `oauth_query`.
 * Its signature covers its own parameters only, those it names in `ba_param` (and `sig`), so the
 * rest of /login's (`next`) is left out, as its client plugin does in a browser.
 */
export function signedOAuthQuery(url: URL) {
	const names = new Set(url.searchParams.getAll('ba_param'));
	if (!url.searchParams.has('sig') || !names.size) return null;
	const signed = new URLSearchParams();
	for (const [key, value] of url.searchParams)
		if (key === 'sig' || key === 'ba_param' || names.has(key)) signed.append(key, value);
	return signed.toString();
}

/** Where the provider says to go back to, once in: the house, with its code. */
export function oauthReturn(result: unknown) {
	if (result && typeof result === 'object' && 'redirect' in result && 'url' in result)
		return result.redirect && typeof result.url === 'string' ? result.url : null;
	return null;
}

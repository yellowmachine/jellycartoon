import { createHash, randomBytes } from 'node:crypto';

/**
 * «Conectar con OpenRouter»: the person signs in there (or makes the account) and authorises the
 * app, and it gets a key of its own, billed to their credit. OAuth with PKCE:
 * https://openrouter.ai/docs/guides/overview/auth/oauth. The house's (Ajustes → Casa) and
 * Seilide's (Ajustes → Conexiones). `label`, the key's name in OpenRouter.
 */
export function openRouterAuth(callbackUrl: string, label: string) {
	const verifier = randomBytes(32).toString('base64url');
	const state = randomBytes(16).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	const url = new URL('https://openrouter.ai/auth');
	url.searchParams.set('callback_url', callbackUrl);
	url.searchParams.set('code_challenge', challenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('state', state);
	url.searchParams.set('key_label', label);
	return { url: url.href, verifier, state };
}

/** The PKCE verifier and the state, from «Conectar» until OpenRouter sends the browser back. */
export const OAUTH_COOKIE = 'openrouter_oauth';

/** What a cookie with the verifier and the state says; empty if it is not one. */
export function pendingAuth(saved: string | undefined): { verifier?: string; state?: string } {
	try {
		const parsed = JSON.parse(saved ?? '{}');
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

/** The code OpenRouter came back with, for the key (single use, valid 10 minutes). */
export async function openRouterKeyFromCode(code: string, verifier: string) {
	const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
		signal: AbortSignal.timeout(15_000)
	});
	const body = await res.json().catch(() => null);
	if (!res.ok || typeof body?.key !== 'string')
		throw new Error(`OpenRouter: ${body?.error?.message ?? res.statusText}`);
	return body.key as string;
}

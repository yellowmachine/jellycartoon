import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { OAUTH_COOKIE, openRouterKeyFromCode, pendingAuth } from 'comun/openrouter-oauth.ts';
import { withFamily } from '#lib/server/family.ts';
import { setOpenRouterKey } from '#lib/server/family-settings.ts';
import { kitchenOf } from '#lib/server/fridge.ts';

/**
 * Back from OpenRouter after «Conectar con OpenRouter» (Ajustes → Conexiones): its code, for the
 * family's key, which takes the place of the one before. Then back to Ajustes, saying how it went.
 */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const admin =
		locals.user && (await withFamily(locals.user.id, async (_, m) => m.role === 'admin'));
	if (!admin) error(403, 'Solo quien administra la familia');
	const pending = pendingAuth(cookies.get(OAUTH_COOKIE));
	cookies.delete(OAUTH_COOKIE, { path: '/ajustes' });
	const back = (result: string): never =>
		redirect(303, `/ajustes?seccion=conexiones&openrouter=${encodeURIComponent(result)}#ia`);

	const code = url.searchParams.get('code');
	// Cancelled there, or no code: nothing changes.
	if (!code) return back('cancelado');
	// Not the request this browser started (or more than 10 minutes ago).
	if (!pending.verifier || pending.state !== url.searchParams.get('state')) return back('caducado');
	try {
		const key = await openRouterKeyFromCode(code, pending.verifier);
		await setOpenRouterKey(await kitchenOf(locals.user!.id), key);
	} catch (err) {
		console.warn('[ajustes] No se pudo conectar con OpenRouter', err);
		return back('error');
	}
	return back('ok');
};

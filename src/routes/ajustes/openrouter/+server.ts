import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAdmin, setAppSetting } from '#lib/server/app-settings.ts';
import { log } from '#lib/server/log.ts';
import { OAUTH_COOKIE, openRouterKeyFromCode } from '#lib/server/openrouter.ts';

/**
 * Back from OpenRouter after «Conectar con OpenRouter» (Ajustes): its code, for the key, which
 * takes the place of the one written in Ajustes. Then back to Ajustes, saying how it went.
 */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	if (!locals.user || !(await isAdmin(locals.user.id))) error(403, 'Solo para quien administra');
	const saved = cookies.get(OAUTH_COOKIE);
	cookies.delete(OAUTH_COOKIE, { path: '/ajustes' });
	const back = (result: string): never =>
		redirect(303, `/ajustes?seccion=casa&openrouter=${encodeURIComponent(result)}#ia`);

	const code = url.searchParams.get('code');
	// Cancelled there, or no code: nothing changes.
	if (!code) return back('cancelado');
	let pending: { verifier?: string; state?: string } = {};
	try {
		pending = JSON.parse(saved ?? '{}');
	} catch {
		// Stays empty.
	}
	// Not the request this browser started (or more than 10 minutes ago).
	if (!pending.verifier || pending.state !== url.searchParams.get('state')) return back('caducado');
	try {
		const key = await openRouterKeyFromCode(code!, pending.verifier!);
		await setAppSetting('openrouter_api_key', key);
	} catch (err) {
		log.warn('ajustes', 'No se pudo conectar con OpenRouter', { error: err });
		return back('error');
	}
	log.info('ajustes', 'Conectado con OpenRouter: clave nueva');
	return back('ok');
};

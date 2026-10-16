import type { RequestHandler } from './$types';
import { musicRoot } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { subsonicUser } from '#lib/server/subsonic/auth.ts';
import { METHODS } from '#lib/server/subsonic/methods.ts';
import { ERROR, failed } from '#lib/server/subsonic/protocol.ts';

/**
 * The Subsonic API, for music apps such as Tempus (#27): `/rest/<method>`, also with the old
 * `.view`. Logged in with the account's email and its password for apps (Ajustes), not with the
 * session: it is public in hooks.server.ts. Only GET: SvelteKit refuses form posts from elsewhere,
 * and without announcing OpenSubsonic's `formPost` no app sends them.
 */
export const GET: RequestHandler = async ({ request, params: route, url }) => {
	const params = url.searchParams;
	if (!musicRoot) return failed(ERROR.generic, 'No hay carpeta de música (MUSIC_DIR)');
	if (!params.get('u')) return failed(ERROR.missingParameter, 'Falta el usuario (u)');
	const user = await subsonicUser(params);
	if (!user) return failed(ERROR.wrongCredentials, 'Usuario o contraseña para apps incorrectos');

	const name = route.method.replace(/\.view$/, '');
	const run = METHODS[name];
	if (!run) {
		log.info('subsonic', `Método no soportado: ${name}`, { client: params.get('c') });
		return failed(ERROR.generic, `No soportado: ${name}`);
	}
	return run(params, request, user);
};

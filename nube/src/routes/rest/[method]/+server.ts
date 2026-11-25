import type { RequestHandler } from './$types';
import { ERROR } from 'comun/server/subsonic/protocol.ts';
import { failed, libraryOf, methodOf } from '#lib/server/subsonic/methods.ts';
import { musicApps, tries } from '#lib/server/subsonic/subsonic.ts';

/**
 * The Subsonic API, for music apps such as Tempus (#625): the family's bucket. `/rest/<method>`,
 * also with the old `.view`, with the account's email and its password for apps (Ajustes), not with
 * the session: it is public in hooks.server.ts. Only GET, as in the house.
 */
export const GET: RequestHandler = async ({ request, params: route, url, getClientAddress }) => {
	const params = url.searchParams;
	const account = params.get('u')?.trim().toLowerCase();
	if (!account) return failed(ERROR.missingParameter, 'Falta el usuario (u)');
	const ip =
		request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || getClientAddress();
	if (tries.blocked(ip, account))
		return failed(ERROR.wrongCredentials, 'Demasiados intentos: prueba dentro de un rato', 429);
	const user = await musicApps.userOf(params);
	if (!user) {
		tries.failed(ip, account);
		return failed(ERROR.wrongCredentials, 'Usuario o contraseña para apps incorrectos');
	}
	const run = methodOf(route.method.replace(/\.view$/, ''));
	if (!run) return failed(ERROR.generic, 'No soportado');
	if (!(await libraryOf(user.familyId)))
		return failed(ERROR.generic, 'Tu familia no tiene música en su almacenamiento');
	return run(params, request, user);
};

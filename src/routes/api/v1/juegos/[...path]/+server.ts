import { error, type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import { cloudPerson } from '#lib/server/media-api.ts';
import * as rom from '../../../juegos/[system]/[file]/+server.ts';
import * as picture from '../../../juegos/imagen/[id]/[kind]/+server.ts';
import * as cartridge from '../../../juegos/cartucho/[gameId]/+server.ts';
import * as saves from '../../../juegos/partidas/[gameId]/+server.ts';
import * as save from '../../../juegos/partida/[id]/+server.ts';
import * as saveState from '../../../juegos/partida/[id]/estado/+server.ts';
import * as savePicture from '../../../juegos/partida/[id]/imagen/+server.ts';
import * as sessions from '../../../juegos/sesiones/+server.ts';
import * as session from '../../../juegos/sesiones/[id]/+server.ts';
import * as backdrop from '../../../fondo/juego/[id]/+server.ts';

type Methods = Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', RequestHandler<never>>>;

/**
 * What the game itself asks for while played from Seilide (#405), which passes it on under its own
 * `/api/juegos/…`, as the player asks at home: the same handlers, in the name of the person, an
 * adult. Only these: not RetroDECK nor Steam, on the salon's PC, nor the house-wide shader.
 */
const ROUTES: [string, Methods][] = [
	['cartucho/:gameId', cartridge],
	['partidas/:gameId', saves],
	['partida/:id/estado', saveState],
	['partida/:id/imagen', savePicture],
	['partida/:id', save],
	['sesiones/:id', session],
	['sesiones', sessions],
	['imagen/:id/:kind', picture],
	['fondo/:id', backdrop],
	[':system/:file', rom]
] as unknown as [string, Methods][];

/** The parameters, if `path` is that route's. */
function matches(route: string, path: string[]) {
	const parts = route.split('/');
	if (parts.length !== path.length) return null;
	const params: Record<string, string> = {};
	for (const [i, part] of parts.entries()) {
		if (part.startsWith(':')) params[part.slice(1)] = path[i]!;
		else if (part !== path[i]) return null;
	}
	return params;
}

const handle: RequestHandler = async (event) => {
	const person = await cloudPerson(event.request);
	const path = event.params.path!.split('/');
	for (const [route, methods] of ROUTES) {
		const params = matches(route, path);
		if (!params) continue;
		const handler = methods[event.request.method as keyof Methods];
		if (!handler) error(405, 'Método no permitido');
		event.locals.user = { id: person.id } as App.Locals['user'];
		return handler({ ...event, params } as unknown as RequestEvent<never, never>);
	}
	error(404, 'No encontrado');
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;

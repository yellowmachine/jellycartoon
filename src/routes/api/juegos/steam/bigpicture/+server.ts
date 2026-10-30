import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';
import { openBigPicture, steamLaunchEnabled } from '#lib/server/steam.ts';

/** Opens Steam's Big Picture on the PC with the screen, with no game: its library and store. */
export const POST: RequestHandler = async () => {
	if (!steamLaunchEnabled) error(503, 'Sin el servicio de Steam (STEAM_SOCKET)');
	try {
		await openBigPicture();
	} catch (problem) {
		log.warn('juegos', 'No se pudo abrir Big Picture', { error: problem });
		error(503, 'El PC del salón no abre Steam: ¿está su servicio? (scripts/pantalla.sh)');
	}
	log.info('juegos', 'Big Picture abierto');
	return new Response(null, { status: 204 });
};

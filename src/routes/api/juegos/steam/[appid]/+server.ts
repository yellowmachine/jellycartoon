import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';
import { launchSteamGame, steamGames, steamLaunchEnabled } from '#lib/server/steam.ts';

/** Opens a Steam game on the PC with the screen, in Big Picture: only one that is installed. */
export const POST: RequestHandler = async ({ params }) => {
	if (!steamLaunchEnabled) error(503, 'Sin el servicio de Steam (STEAM_SOCKET)');
	const game = (await steamGames()).find((g) => g.appid === Number(params.appid));
	if (!game) error(404, 'Ese juego no está instalado');
	try {
		await launchSteamGame(game.appid);
	} catch (problem) {
		log.warn('juegos', 'No se pudo abrir el juego de Steam', { appid: game.appid, error: problem });
		error(
			503,
			'El PC del salón no abre los juegos de Steam: ¿está su servicio? (scripts/pantalla.sh)'
		);
	}
	log.info('juegos', 'Juego de Steam abierto', { appid: game.appid, name: game.name });
	return new Response(null, { status: 204 });
};

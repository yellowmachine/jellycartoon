import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';
import { openRetrodeck, retrodeckEnabled } from '#lib/server/retrodeck.ts';

/** Opens RetroDECK on the PC with the screen, with no game: its own menu, to browse. */
export const POST: RequestHandler = async () => {
	if (!(await retrodeckEnabled())) error(503, 'Sin el servicio de RetroDECK (RETRODECK_SOCKET)');
	try {
		await openRetrodeck();
	} catch (problem) {
		log.warn('juegos', 'No se pudo abrir RetroDECK', { error: problem });
		error(503, 'El PC del salón no abre RetroDECK: ¿está su servicio? (scripts/pantalla.sh)');
	}
	log.info('juegos', 'RetroDECK abierto');
	return new Response(null, { status: 204 });
};

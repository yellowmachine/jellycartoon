import emulator from 'comun/emulador.html?raw';
import type { RequestHandler } from './$types';

/** The frame the games are played in (comun's GamePlayer), the same in the house and in Seilide. */
export const GET: RequestHandler = () =>
	new Response(emulator, {
		headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }
	});

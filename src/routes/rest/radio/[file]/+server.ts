import type { RequestHandler } from './$types';
import { streamFor } from '#lib/server/radio.ts';
import { subsonicUser } from '#lib/server/subsonic/auth.ts';

/**
 * A station for music apps (#27), from getInternetRadioStations: `<uuid>` or `<uuid>.m3u8`. To where
 * it streams right now, looked up when it is played, as the Radio page does. The ending is for the
 * apps: Tempus opens HLS only when the address ends in `.m3u8`.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	if (!(await subsonicUser(url.searchParams))) return new Response('Sin acceso', { status: 401 });
	const uuid = params.file.replace(/\.m3u8$/, '');
	const stream = await streamFor(uuid).catch(() => null);
	if (!stream) return new Response('Emisora no disponible', { status: 404 });
	return new Response(null, { status: 302, headers: { location: stream.url } });
};

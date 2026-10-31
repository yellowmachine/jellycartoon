import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudUrl } from '#lib/server/kitchen.ts';
import { cloudPerson } from '#lib/server/media-api.ts';
import { stopDjOnSnapcast } from '#lib/server/music/dj.ts';
import { parseRemote, remoteTracks } from '#lib/server/music/remote-snapcast.ts';
import {
	controlSnapcast,
	remoteOnSnapcast,
	snapcastNow,
	snapcastReady,
	soundOn
} from '#lib/server/music/snapcast.ts';

/**
 * The house's Snapcast for Seilide (#339, Oración), in a grown-up's name (`cloudPerson`: not a
 * child): what it plays now, and `remote`, Seilide's own addresses in the whole house; then pause,
 * a point in the track (`seekTo`, seconds), next, previous and stop.
 */
export const GET: RequestHandler = async ({ request }) => {
	await cloudPerson(request);
	return json({ ready: snapcastReady(), state: snapcastNow() });
};

export const POST: RequestHandler = async ({ request }) => {
	await cloudPerson(request);
	if (!snapcastReady()) error(409, 'Snapcast no está en marcha en casa');
	const body = await request.json().catch(() => null);
	try {
		switch (body?.action) {
			case 'remote': {
				const cloud = await cloudUrl();
				if (!cloud) error(409, 'Casa no tiene Seilide conectada: Ajustes → Casa → «Seilide»');
				const remote = parseRemote(body, cloud);
				if (!remote) error(400, 'Lista no válida');
				stopDjOnSnapcast();
				await soundOn('house');
				await remoteOnSnapcast(remoteTracks(remote));
				break;
			}
			case 'pause':
				if (typeof body.value !== 'boolean') error(400, 'Orden no válida');
				await controlSnapcast({ action: 'pause', value: body.value });
				break;
			case 'seekTo':
				if (typeof body.value !== 'number' || !(body.value >= 0)) error(400, 'Orden no válida');
				await controlSnapcast({ action: 'seekTo', value: body.value });
				break;
			case 'next':
			case 'previous':
			case 'stop':
				if (body.action === 'stop') stopDjOnSnapcast();
				await controlSnapcast({ action: body.action });
				break;
			default:
				error(400, 'Orden no válida');
		}
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		error(503, err instanceof Error ? err.message : String(err));
	}
	return json({ ok: true });
};

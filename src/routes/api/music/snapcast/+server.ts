import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tracksById } from '#lib/server/music/albums.ts';
import {
	controlSnapcast,
	queueOnSnapcast,
	radioOnSnapcast,
	snapcastEnabled
} from '#lib/server/music/snapcast.ts';
import { stopDjOnSnapcast } from '#lib/server/music/dj.ts';
import { episodesOnSnapcast } from '#lib/server/music/episodes-on-snapcast.ts';
import { streamFor } from '#lib/server/radio.ts';
import type { SnapcastAction } from '#lib/music.ts';

const isIds = (value: unknown): value is number[] =>
	Array.isArray(value) && value.length > 0 && value.every((v) => Number.isInteger(v));

/** Only well-formed commands reach mpv. */
function parse(body: Record<string, unknown>): SnapcastAction | null {
	const { action, value, trackIds, start, speakerId, name, uuid, episodeId, startSec, where } =
		body;
	switch (action) {
		case 'play':
			return isIds(trackIds) && Number.isInteger(start)
				? { action, trackIds, start: start as number }
				: null;
		case 'append':
			return isIds(trackIds) ? { action, trackIds } : null;
		case 'radio':
			return typeof uuid === 'string' ? { action, uuid } : null;
		// Where: «house», or one speaker.
		case 'episode':
			return Number.isInteger(episodeId) &&
				(startSec === null || (typeof startSec === 'number' && startSec >= 0)) &&
				(where === 'house' ||
					(typeof where === 'object' &&
						where !== null &&
						'speakerId' in where &&
						typeof where.speakerId === 'string'))
				? {
						action,
						episodeId: episodeId as number,
						startSec: startSec as number | null,
						where: where === 'house' ? 'house' : { speakerId: where.speakerId as string }
					}
				: null;
		case 'pause':
		case 'shuffle':
		case 'repeat':
		case 'single':
		case 'stopAfterTrack':
			return typeof value === 'boolean' ? { action, value } : null;
		case 'stopIn': {
			const minutes = (body as { minutes?: unknown }).minutes;
			return typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0
				? { action, minutes: Math.min(Math.round(minutes), 12 * 60) }
				: null;
		}
		case 'seekTo':
			return typeof value === 'number' && Number.isFinite(value) ? { action, value } : null;
		case 'next':
		case 'previous':
		case 'stop':
			return { action };
		case 'volume':
			return typeof speakerId === 'string' && typeof value === 'number' && Number.isFinite(value)
				? { action, speakerId, value: Math.round(Math.min(Math.max(value, 0), 100)) }
				: null;
		case 'masterVolume':
			return typeof value === 'number' && Number.isFinite(value)
				? { action, value: Math.round(Math.min(Math.max(value, 0), 100)) }
				: null;
		case 'masterMute':
			return typeof value === 'boolean' ? { action, value } : null;
		case 'mute':
			return typeof speakerId === 'string' && typeof value === 'boolean'
				? { action, speakerId, value }
				: null;
		case 'rename':
			return typeof speakerId === 'string' && typeof name === 'string'
				? { action, speakerId, name: name.trim().slice(0, 100) }
				: null;
		default:
			return null;
	}
}

/** A button of the music on Snapcast. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!snapcastEnabled) error(404, 'No hay Snapcast configurado (MUSIC_MPV_SOCKET)');
	const remote = parse(await request.json());
	if (!remote) error(400, 'Orden no válida');
	try {
		// Something else instead of what was on: out of Modo DJ. More songs, or a pause, keep it.
		if (remote.action === 'play' || remote.action === 'radio' || remote.action === 'stop')
			stopDjOnSnapcast();
		if (remote.action === 'radio') {
			// Only our stations, and their stream as Radio Browser has it now.
			const stream = await streamFor(remote.uuid);
			if (!stream) error(404, 'Emisora no encontrada');
			await radioOnSnapcast(stream);
		} else if (remote.action === 'episode') {
			await episodesOnSnapcast(locals.user!.id, remote.episodeId, remote.startSec, remote.where);
		} else if (remote.action === 'play' || remote.action === 'append') {
			const tracks = await tracksById(remote.trackIds);
			if (!tracks.length) error(400, 'No hay canciones que poner');
			await queueOnSnapcast(tracks, {
				replace: remote.action === 'play',
				start: remote.action === 'play' ? remote.start : undefined
			});
		} else {
			await controlSnapcast(remote);
		}
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		error(503, err instanceof Error ? err.message : String(err));
	}
	return json({ ok: true });
};

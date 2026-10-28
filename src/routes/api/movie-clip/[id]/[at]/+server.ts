import { error } from '@sveltejs/kit';
import { AUDIO_LANG } from '$app/env/private';
import type { RequestHandler } from './$types';
import { movieClip } from '#lib/server/cinema/clips.ts';
import { fileResponse } from 'comun/server/file-response.ts';
import { getSettings } from '#lib/server/settings.ts';
import { log } from '#lib/server/log.ts';

/** A clip of the film from that second, to watch in the browser; made the first time it is asked for. */
export const GET: RequestHandler = async ({ params, request, locals }) => {
	const movieId = Number(params.id);
	const atSec = Number(params.at);
	if (!Number.isInteger(atSec) || atSec < 0) error(400, 'Momento no válido');
	const audioLang = (await getSettings(locals.user!.id)).audioLang ?? AUDIO_LANG ?? null;

	let file;
	try {
		file = await movieClip(movieId, atSec, audioLang);
	} catch (err) {
		log.warn('cine', `No se pudo sacar el clip del segundo ${atSec}`, { movieId, error: err });
		error(500, 'No se pudo sacar el clip');
	}
	if (!file) error(404, 'Película no encontrada');
	return fileResponse(request, file, 'video/mp4', 'private, max-age=86400');
};

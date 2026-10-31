import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { prayerAudioFile, prayerModeOn } from '#lib/server/prayers.ts';
import { readFile } from '#lib/server/storage.ts';

/**
 * A text's recording (#339), only to its family. With ranges, as the `<audio>` asks for them to go
 * to a point of it: without them, the browser cannot move along it. `?v=` (what it was recorded
 * with) changes with each recording, so it is kept a day.
 */
export const GET: RequestHandler = async ({ params, locals, request }) => {
	const k = await kitchenOf(locals.user!.id);
	if (!(await prayerModeOn(k))) error(404, 'No encontrado');
	const file = await prayerAudioFile(k, Number(params.id));
	const bytes = file ? await readFile(k.familyId, 'oracion', file) : null;
	if (!bytes) error(404, 'Sin voz');
	const headers = {
		'Content-Type': 'audio/ogg',
		'Accept-Ranges': 'bytes',
		'Cache-Control': 'private, max-age=86400'
	};
	const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
	if (!range || (!range[1] && !range[2])) return new Response(bytes, { headers });
	const size = bytes.length;
	// «bytes=-500»: the last 500.
	const start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
	const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
	if (start >= size || start > end)
		return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
	return new Response(bytes.subarray(start, end + 1), {
		status: 206,
		headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}` }
	});
};

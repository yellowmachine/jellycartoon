import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { duck, mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { duckSpeaker } from '#lib/server/music/snapcast.ts';

/**
 * The living room lowered while someone speaks to the voice, and back after (mpv.ts, `duck`); from
 * a satellite, its own Snapcast speaker too (snapcast.ts, `duckSpeaker`).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const speaker = locals.satellite?.speakerId ?? null;
	if (!mpvEnabled && !speaker) error(404, 'No hay mpv configurado');
	const { on } = await request.json().catch(() => ({}));
	if (typeof on !== 'boolean') error(400, 'Orden no válida');
	// Each one whatever the other does: mpv may be off while the music plays.
	const failed = (
		await Promise.allSettled([
			mpvEnabled ? duck(on) : null,
			speaker ? duckSpeaker(speaker, on) : null
		])
	).find((r) => r.status === 'rejected');
	if (failed)
		error(503, failed.reason instanceof Error ? failed.reason.message : String(failed.reason));
	return json({ ok: true });
};

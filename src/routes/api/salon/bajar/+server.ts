import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { duck, mpvEnabled } from '#lib/server/cinema/mpv.ts';

/** The living room lowered while someone speaks to the voice, and back after (mpv.ts, `duck`). */
export const POST: RequestHandler = async ({ request }) => {
	if (!mpvEnabled) error(404, 'No hay mpv configurado');
	const { on } = await request.json().catch(() => ({}));
	if (typeof on !== 'boolean') error(400, 'Orden no válida');
	try {
		await duck(on);
	} catch (err) {
		error(503, err instanceof Error ? err.message : String(err));
	}
	return json({ ok: true });
};

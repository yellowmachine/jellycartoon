import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { control, mpvEnabled } from '#lib/server/cinema/mpv.ts';
import type { RemoteAction } from '#lib/salon.ts';

const isNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

/** Only well-formed commands reach mpv. */
function parse(body: { action?: unknown; value?: unknown }): RemoteAction | null {
	const { action, value } = body;
	switch (action) {
		case 'pause':
			return typeof value === 'boolean' ? { action, value } : null;
		case 'seek':
		case 'seekTo':
			return isNumber(value) ? { action, value } : null;
		case 'volume':
			return isNumber(value) ? { action, value: Math.min(Math.max(value, 0), 130) } : null;
		case 'audio':
			return Number.isInteger(value) ? { action, value: value as number } : null;
		case 'subtitle':
			return value === null || Number.isInteger(value)
				? { action, value: value as number | null }
				: null;
		case 'stop':
			return { action };
		default:
			return null;
	}
}

/** A button of the remote. */
export const POST: RequestHandler = async ({ request }) => {
	if (!mpvEnabled) error(404, 'No hay mpv configurado');
	const remote = parse(await request.json());
	if (!remote) error(400, 'Orden no válida');
	try {
		await control(remote);
	} catch (err) {
		error(503, err instanceof Error ? err.message : String(err));
	}
	return json({ ok: true });
};

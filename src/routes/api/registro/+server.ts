import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';

/**
 * What the players did with the phone's page hidden (media-diagnostics.ts), to the Registro
 * (`reproductor`): one entry per batch, with who, which device and its browser (#120, its first
 * piece).
 */

/** A long walk's events fit; anything bigger is not ours. */
const MAX_BYTES = 64 * 1024;
const MAX_EVENTS = 200;
/** One batch every so often per user: a page gone wrong does not fill the Registro. */
const EVERY_MS = 5_000;
const last = new Map<string, number>();

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user!;
	const now = Date.now();
	if (now - (last.get(user.id) ?? 0) < EVERY_MS) error(429, 'Demasiado seguido');
	const text = await request.text();
	if (text.length > MAX_BYTES) error(413, 'Demasiado grande');
	let body: { device?: unknown; events?: unknown };
	try {
		body = JSON.parse(text);
	} catch {
		error(400, 'No es JSON');
	}
	if (!Array.isArray(body.events) || !body.events.length || body.events.length > MAX_EVENTS)
		error(400, 'Sin eventos');
	last.set(user.id, now);
	const events = body.events.map((e) => {
		const { at, what, media, detail } = (e ?? {}) as Record<string, unknown>;
		return {
			at: String(at ?? '').slice(0, 40),
			what: String(what ?? '').slice(0, 100),
			...(media ? { media: String(media).slice(0, 20) } : {}),
			...(detail ? { detail: String(detail).slice(0, 300) } : {})
		};
	});
	// In a line, what happened: «play, terminó, play() rechazado…», for the list.
	const summary = events
		.map((e) => (e.media ? `${e.what} (${e.media})` : e.what))
		.join(' → ')
		.slice(0, 300);
	log.info('reproductor', `Con la página oculta: ${summary}`, {
		user: user.name,
		device: typeof body.device === 'string' ? body.device.slice(0, 50) : null,
		browser: request.headers.get('user-agent')?.slice(0, 300) ?? null,
		events
	});
	return new Response(null, { status: 204 });
};

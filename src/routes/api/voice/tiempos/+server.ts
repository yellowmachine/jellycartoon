import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';

const seconds = (ms: number) => (ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 2 });

/** A stage's milliseconds as the phone measured them: a sane number, or none. */
const ms = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 600_000
		? Math.round(value)
		: null;

/**
 * How long an order took as the phone lived it (#33): from the end of what was said until the
 * answer starts to sound, by stages. With the server's own line (`voz`), what is left is the network.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Tiempos no válidos');
	const total = ms(body.total);
	if (total === null) error(400, 'Tiempos no válidos');
	const stages = {
		transcribe: ms(body.transcribe),
		command: ms(body.command),
		speak: ms(body.speak)
	};
	const said = typeof body.text === 'string' ? body.text.slice(0, 200) : '';
	const parts = [
		stages.transcribe !== null && `transcribir ${seconds(stages.transcribe)}`,
		stages.command !== null && `orden ${seconds(stages.command)}`,
		stages.speak !== null && `empezar a hablar ${seconds(stages.speak)}`
	].filter(Boolean);
	log.info(
		'voz',
		`En el móvil, «${said}»: ${seconds(total)} s hasta oír la respuesta (${parts.join(' · ')})`,
		{ total, ...stages, handsFree: body.handsFree === true }
	);
	return new Response(null, { status: 204 });
};

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';
import { runVoiceCommand } from '#lib/server/voice/command.ts';
import { voiceEnabled } from '#lib/server/voice/whisper.ts';
import { NO_CREDIT } from '#lib/server/openrouter.ts';
import { parseVoiceRequest, type VoiceReply } from '#lib/voice.ts';

/** As the AI would answer, for whoever asked: the details are in the banner (+layout.svelte). */
const SAID_NO_CREDIT =
	'Se ha acabado el crédito de la inteligencia artificial. Hay que recargarlo y darle a «Ya he recargado» en la app.';

/** «1,25»: seconds, from milliseconds. */
const seconds = (ms: number) => (ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 2 });

/** What was said (or written) in /voz, done: what the device must do, and what to answer. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!voiceEnabled) error(404, 'No hay voz configurada (WHISPER_URL)');
	const command = parseVoiceRequest(await request.json().catch(() => null));
	if (!command) error(400, 'Orden no válida');
	try {
		const started = performance.now();
		// A satellite's (#223): in the name of who made its key, said by «la casa».
		const satellite = locals.satellite;
		const { timing, ...reply } = satellite
			? await runVoiceCommand(command, { id: satellite.ownerId, name: '' }, satellite.name)
			: await runVoiceCommand(command, { id: locals.user!.id, name: locals.user!.name });
		const ms = Math.round(performance.now() - started);
		// Where the time went, in the line itself: «2,4 s (preparar 0,04 · IA 1,1 + 0,9)».
		const parts = [
			`preparar ${seconds(timing.prepareMs)}`,
			`IA ${timing.rounds.map((r) => seconds(r.ms)).join(' + ')}`
		];
		log.info(
			'voz',
			`«${command.text}» → «${reply.reply}» · ${seconds(ms)} s (${parts.join(' · ')})`,
			{
				ms,
				...(satellite ? { satellite: satellite.name } : {}),
				...timing,
				history: command.history.length,
				actions: reply.actions.map((a) => a.kind),
				options: reply.options.length
			}
		);
		return json(reply);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		// Said, not an error: a satellite reads it aloud (with Piper, which needs no credit).
		if (message === NO_CREDIT) {
			log.warn('voz', `«${command.text}»: sin crédito de la IA`);
			return json({ reply: SAID_NO_CREDIT, actions: [], options: [] } satisfies VoiceReply);
		}
		log.error('voz', `«${command.text}»: ${message}`);
		error(503, message);
	}
};

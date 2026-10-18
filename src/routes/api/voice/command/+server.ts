import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';
import { runVoiceCommand } from '#lib/server/voice/command.ts';
import { voiceEnabled } from '#lib/server/voice/whisper.ts';
import { parseVoiceRequest } from '#lib/voice.ts';

/** What was said (or written) in /voz, done: what the device must do, and what to answer. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!voiceEnabled) error(404, 'No hay voz configurada (WHISPER_URL)');
	const command = parseVoiceRequest(await request.json().catch(() => null));
	if (!command) error(400, 'Orden no válida');
	try {
		const started = performance.now();
		const { id, name } = locals.user!;
		const reply = await runVoiceCommand(command, { id, name });
		log.info('voz', `«${command.text}» → «${reply.reply}»`, {
			ms: Math.round(performance.now() - started),
			actions: reply.actions.map((a) => a.kind),
			options: reply.options.length
		});
		return json(reply);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('voz', `«${command.text}»: ${message}`);
		error(503, message);
	}
};

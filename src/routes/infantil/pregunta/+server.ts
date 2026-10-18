import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { answerKidQuestion } from '#lib/server/kid-questions.ts';
import { log } from '#lib/server/log.ts';
import { parseKidQuestion } from '#lib/kid-questions.ts';

/**
 * A question about what the children watch, answered by the AI. Adults only: a child's account
 * never gets here, as with the rest of /infantil (see kids.ts).
 */
export const POST: RequestHandler = async ({ request }) => {
	const question = parseKidQuestion(await request.json().catch(() => null));
	if (!question) error(400, 'Pregunta no válida');
	try {
		const started = performance.now();
		const reply = await answerKidQuestion(question);
		log.info('infantil', `«${question.text}» → «${reply}»`, {
			ms: Math.round(performance.now() - started)
		});
		return json({ reply });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('infantil', `«${question.text}»: ${message}`);
		error(503, message);
	}
};

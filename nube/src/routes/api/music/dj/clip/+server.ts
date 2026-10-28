import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { djWords } from '#lib/server/music.ts';

/**
 * Modo DJ (comun's dj.svelte.ts), as at home: what the DJ says, written and read by the house; its
 * audio, by the pass (music-pass.svelte.ts).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		return json(
			await djWords(
				{ id: locals.user!.id, email: locals.user!.email },
				await request.json().catch(() => null)
			)
		);
	} catch (err) {
		if (err instanceof HouseProblem) error(502, err.message);
		throw err;
	}
};

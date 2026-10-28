import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { djSongs } from '#lib/server/music.ts';

/** Modo DJ (comun's dj.svelte.ts), as at home: more songs at random, from the house. */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		return json(
			await djSongs(
				{ id: locals.user!.id, email: locals.user!.email },
				await request.json().catch(() => null)
			)
		);
	} catch (err) {
		if (err instanceof HouseProblem) error(502, err.message);
		throw err;
	}
};

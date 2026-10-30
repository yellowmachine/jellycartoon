import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchEpisodes } from '#lib/server/homework.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { isKidAccount } from '#lib/server/kids.ts';

/**
 * Homework (#142): «u otro capítulo», any episode with dialogue of the house's children's series
 * (`?q=dexter`), for when a child watched it elsewhere or will watch it. Only the grown-ups.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (await isKidAccount(locals.user!.id)) error(403, 'Solo los mayores');
	try {
		return json(
			await searchEpisodes(
				{ userId: locals.user!.id, email: locals.user!.email },
				url.searchParams.get('q') ?? ''
			)
		);
	} catch (err) {
		if (err instanceof HouseProblem) error(502, err.message);
		throw err;
	}
};

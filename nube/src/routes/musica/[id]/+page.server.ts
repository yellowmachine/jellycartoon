import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { askHouse, HouseProblem } from '#lib/server/house.ts';
import type { MusicAlbum } from 'comun/music.ts';

/** An album and its tracks (#253), the house's. */
export const load: PageServerLoad = async ({ params, locals }) => {
	try {
		const { album } = await askHouse<{ album: MusicAlbum }>(
			locals.user!.id,
			locals.user!.email,
			`/musica/albumes/${Number(params.id)}`
		);
		return { album };
	} catch (err) {
		if (err instanceof HouseProblem) error(404, err.message);
		throw err;
	}
};

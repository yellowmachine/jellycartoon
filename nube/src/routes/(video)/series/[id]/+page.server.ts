import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { seriesEpisodes, setWatched } from '#lib/server/series.ts';

const whoOf = (locals: App.Locals) => ({ id: locals.user!.id, email: locals.user!.email });

/** A series (#253), the house's: its episodes ready to watch, by season, with where they were left. */
export const load: PageServerLoad = async ({ params, locals }) => {
	let found;
	try {
		found = await seriesEpisodes(whoOf(locals), Number(params.id));
	} catch (err) {
		if (err instanceof HouseProblem) error(404, err.message);
		throw err;
	}
	const seasons = Map.groupBy(found.episodes, (e) => e.season);
	return {
		series: { id: found.id, title: found.title },
		seasons: [...seasons].map(([season, episodes]) => ({ season, episodes }))
	};
};

export const actions: Actions = {
	/** Watched or not, at home: «Seguir viendo» is the same in both. */
	setWatched: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Capítulo no válido' });
		try {
			await setWatched(whoOf(locals), id, form.get('watched') === 'true');
		} catch (err) {
			if (!(err instanceof HouseProblem)) throw err;
			return fail(502, { message: err.message });
		}
	}
};

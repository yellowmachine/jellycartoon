import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { musicFolder } from '#lib/server/music.ts';

/** Música → Carpetas (as jellycartoon's): a folder of the house's music as it is on disk. */
export const load: PageServerLoad = async ({ url, locals, parent }) => {
	// The family's own bucket as this person's source (#534, phase 3): its folders instead.
	if ((await parent()).source === 'propia')
		redirect(307, `/musica/tu-musica/carpetas${url.search}`);
	try {
		return {
			folder: await musicFolder(
				{ id: locals.user!.id, email: locals.user!.email },
				url.searchParams.get('ruta') ?? ''
			)
		};
	} catch (err) {
		if (err instanceof HouseProblem) error(404, err.message);
		throw err;
	}
};

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * «Leer» (#634), where a web saved in Notas was read until 2026-11-28: now it is read in Textos,
 * in Notas itself. Kept for the links already made.
 */
export const load: PageServerLoad = ({ params, url }) => {
	const id = Number(params.id);
	redirect(
		308,
		`/notas?texto${Number.isInteger(id) && id > 0 ? `&ver=${id}` : ''}${url.searchParams.has('sin') ? '&sin' : ''}`
	);
};

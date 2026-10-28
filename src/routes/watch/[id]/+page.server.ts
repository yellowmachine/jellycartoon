import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { watchPage } from '#lib/server/watch-page.ts';
import { askEveryTogether } from '#lib/server/still-there.ts';
import { languaConfig } from '#lib/server/langua.ts';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const userId = locals.user!.id;
	// `?t=0` starts from there instead of where it was left.
	const t = url.searchParams.get('t');
	const [watch, ask, langua] = await Promise.all([
		watchPage(userId, Number(params.id), t === null ? null : Number(t) || 0),
		askEveryTogether(userId, locals.session?.id),
		languaConfig(userId)
	]);
	if (!watch) error(404, 'Episodio no disponible');
	return {
		...watch,
		/** «¿Sigues ahí?» after this many started by themselves (#77), the group's lowest (#160); null, never. */
		askEvery: ask,
		/** Their Langua is set (Ajustes): «Mandar a Langua» in the player's menu. */
		langua: Boolean(langua)
	};
};

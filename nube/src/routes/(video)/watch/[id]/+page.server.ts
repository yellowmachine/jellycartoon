import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { watchEpisode } from '#lib/server/series.ts';
import { subtitleStyleOf } from '#lib/server/subtitles.ts';

/**
 * An episode to watch (#253): the house's signed links to its video and to where it is saved, its
 * audios and subtitles, what follows, and this person's choices: the languages, the house's; the
 * subtitles' style, the cloud's (Ajustes → Para mí). `?t=0` starts from there instead of where it
 * was left.
 */
export const load: PageServerLoad = async ({ params, url, locals }) => {
	const t = url.searchParams.get('t');
	let watch;
	try {
		watch = await watchEpisode(
			{ id: locals.user!.id, email: locals.user!.email },
			Number(params.id),
			t === null ? null : Number(t) || 0
		);
	} catch (err) {
		if (err instanceof HouseProblem) error(404, err.message);
		throw err;
	}
	const subtitleStyle = await subtitleStyleOf(await kitchenOf(locals.user!.id));
	return { ...watch, settings: { ...watch.settings, subtitleStyle } };
};

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { continueWatching, dailymotionEnabled, sources } from '#lib/server/dailymotion.ts';
import { isKid } from '#lib/server/kids.ts';

/** Dailymotion (#66): the accounts and playlists the adults chose, and what was left halfway. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!dailymotionEnabled) error(404, 'No hay Dailymotion configurado (DAILYMOTION_PLAYER_ID)');
	const [chosen, halfway] = await Promise.all([sources(), continueWatching(locals.user!.id)]);
	return {
		sources: chosen.map((s) => ({ id: s.id, kind: s.kind, name: s.name, image: s.image })),
		halfway,
		/** Who can choose them: the adults, in Infantil. */
		canChoose: !isKid(locals.user)
	};
};

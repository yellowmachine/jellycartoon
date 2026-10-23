import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { dailymotionEnabled, progressMap, source, sourceVideos } from '#lib/server/dailymotion.ts';

/** The videos of one account or playlist the adults chose, a page at a time. */
export const load: PageServerLoad = async ({ params, url, locals }) => {
	if (!dailymotionEnabled) error(404, 'No hay Dailymotion configurado (DAILYMOTION_PLAYER_ID)');
	const src = await source(Number(params.id));
	if (!src) error(404, 'No encontrado');
	const page = Math.max(1, Math.min(50, Number(url.searchParams.get('pagina')) || 1));
	const [{ videos, more }, progress] = await Promise.all([
		sourceVideos(src, page).catch((err) => {
			error(502, err instanceof Error ? err.message : String(err));
		}),
		progressMap(locals.user!.id)
	]);
	return {
		source: { name: src.name, kind: src.kind },
		page,
		more,
		videos: videos.map((v) => ({
			...v,
			positionSec: progress.get(v.id)?.positionSec ?? 0,
			completed: progress.get(v.id)?.completed ?? false
		}))
	};
};

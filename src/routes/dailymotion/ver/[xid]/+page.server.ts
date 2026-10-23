import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	allowedVideo,
	dailymotionEnabled,
	dailymotionPlayerId,
	progressOf
} from '#lib/server/dailymotion.ts';

/**
 * A Dailymotion video (#66), only if it is suitable and from an account or playlist the adults
 * chose; otherwise it does not exist here. Out of a child's time, /descanso (VIDEO_ROUTES).
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!dailymotionEnabled) error(404, 'No hay Dailymotion configurado (DAILYMOTION_PLAYER_ID)');
	const video = await allowedVideo(params.xid);
	if (!video) error(404, 'Este vídeo no está entre los elegidos para ver aquí');
	const positionSec = await progressOf(locals.user!.id, video.id);
	return {
		video,
		playerId: dailymotionPlayerId!,
		// Near the end it starts again.
		startSec:
			video.durationSec && positionSec < video.durationSec - 10 ? Math.floor(positionSec) : 0
	};
};

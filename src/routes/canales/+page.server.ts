import type { Actions, PageServerLoad } from './$types';
import { playOnSalon } from '#lib/server/channel-actions.ts';
import { isKid } from '#lib/server/kids.ts';
import { getSettings } from '#lib/server/settings.ts';
import { channelsFor } from '#lib/channels.ts';

// A child's account, only at its times (VIDEO_ROUTES): out of them, «/descanso».
export const load: PageServerLoad = async ({ locals }) => ({
	channels: channelsFor(isKid(locals.user)),
	subtitleStyle: (await getSettings(locals.user!.id)).subtitleStyle
});

export const actions: Actions = { salon: playOnSalon };

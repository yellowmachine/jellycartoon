import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { playOnSalon } from '#lib/server/channel-actions.ts';
import { isKid } from '#lib/server/kids.ts';
import { channelsFor } from 'comun/channels.ts';

export const load: PageServerLoad = ({ locals }) => {
	if (!mpvEnabled) error(404, 'No hay mpv configurado (MPV_SOCKET)');
	return { channels: channelsFor(isKid(locals.user)) };
};

export const actions: Actions = { play: playOnSalon };

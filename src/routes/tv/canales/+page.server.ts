import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { mpvEnabled, playChannel } from '#lib/server/cinema/mpv.ts';
import { log } from '#lib/server/log.ts';
import { CHANNELS } from '#lib/channels.ts';

// Not for children's accounts yet: it is not in KIDS_ROUTES.
export const load: PageServerLoad = () => {
	if (!mpvEnabled) error(404, 'No hay mpv configurado (MPV_SOCKET)');
};

export const actions: Actions = {
	/** Live, on the living room's mpv. */
	play: async ({ request }) => {
		const id = (await request.formData()).get('id');
		const channel = CHANNELS.find((c) => c.id === id);
		if (!channel) return fail(400, { message: 'Canal no válido' });
		try {
			await playChannel(channel);
		} catch (err) {
			log.error('mpv', `No se pudo poner ${channel.name}`, { error: err });
			return fail(500, { message: err instanceof Error ? err.message : String(err) });
		}
		return { playing: channel.name };
	}
};

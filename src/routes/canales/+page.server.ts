import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { mpvEnabled, playChannel } from '#lib/server/cinema/mpv.ts';
import { log } from '#lib/server/log.ts';
import { getSettings } from '#lib/server/settings.ts';
import { CHANNELS } from '#lib/channels.ts';

// Not for children's accounts yet: it is not in KIDS_ROUTES.
export const load: PageServerLoad = async ({ locals }) => ({
	subtitleStyle: (await getSettings(locals.user!.id)).subtitleStyle
});

export const actions: Actions = {
	/** On the living room's mpv instead of here. */
	salon: async ({ request }) => {
		if (!mpvEnabled) return fail(400, { message: 'No hay mpv configurado (MPV_SOCKET)' });
		const id = (await request.formData()).get('id');
		const channel = CHANNELS.find((c) => c.id === id);
		if (!channel) return fail(400, { message: 'Canal no válido' });
		try {
			await playChannel(channel);
		} catch (err) {
			log.error('mpv', `No se pudo poner ${channel.name}`, { error: err });
			return fail(500, { message: err instanceof Error ? err.message : String(err) });
		}
		return { salon: channel.name };
	}
};

import { fail, type Action } from '@sveltejs/kit';
import { mpvEnabled, playChannel } from '#lib/server/cinema/mpv.ts';
import { isKid } from '#lib/server/kids.ts';
import { videoClosed } from '#lib/server/kid-time.ts';
import { log } from '#lib/server/log.ts';
import { channelsFor } from 'comun/channels.ts';

/** A channel, live, on the living room's mpv: from the TV view and from /canales. */
export const playOnSalon: Action = async ({ request, locals }) => {
	if (!mpvEnabled) return fail(400, { message: 'No hay mpv configurado (MPV_SOCKET)' });
	const id = (await request.formData()).get('id');
	const channel = channelsFor(isKid(locals.user)).find((c) => c.id === id);
	if (!channel) return fail(400, { message: 'Canal no válido' });
	const userId = locals.user!.id;
	const closed = await videoClosed(userId);
	if (closed) return fail(403, { message: closed });
	try {
		await playChannel(userId, channel);
	} catch (err) {
		log.error('mpv', `No se pudo poner ${channel.name}`, { error: err });
		return fail(500, { message: err instanceof Error ? err.message : String(err) });
	}
	return { salon: channel.name };
};

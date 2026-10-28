import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { subtitleStyleOf } from '#lib/server/subtitles.ts';
import { channelsFor } from 'comun/channels.ts';

/**
 * TV channels, live (#253; jellycartoon's), straight from each broadcaster: nothing goes through the
 * house. The cloud's people are adults: every channel.
 */
export const load: PageServerLoad = async ({ locals }) => ({
	channels: channelsFor(false),
	subtitleStyle: await subtitleStyleOf(await kitchenOf(locals.user!.id))
});

import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { watchStats } from '#lib/server/watch-log.ts';
import { localDay } from 'comun/agenda.ts';

const PERIODS = [4, 12, 26, 52];

/** Estadísticas (#421): one's own hours and the children's; `?persona=`, of one of them. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const asked = Number(url.searchParams.get('semanas'));
	const weeks = PERIODS.includes(asked) ? asked : 12;
	const k = await kitchenOf(locals.user!.id);
	return {
		periods: PERIODS,
		period: weeks,
		stats: await watchStats(k, locals.user!.id, localDay(), weeks, url.searchParams.get('persona'))
	};
};

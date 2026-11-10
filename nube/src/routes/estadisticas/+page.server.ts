import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { KINDS, watchStats, type WatchKind } from '#lib/server/watch-log.ts';
import { localDay } from 'comun/agenda.ts';

const PERIODS = [4, 12, 26, 52];

/**
 * Estadísticas (#421): one's own hours and the children's; `?persona=`, of one of them; `?tipo=`,
 * only series, films, channels, webs or
 * games.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const asked = Number(url.searchParams.get('semanas'));
	const weeks = PERIODS.includes(asked) ? asked : 12;
	const tipo = url.searchParams.get('tipo');
	const kind = KINDS.includes(tipo as WatchKind) ? (tipo as WatchKind) : null;
	const k = await kitchenOf(locals.user!.id);
	const today = localDay();
	return {
		periods: PERIODS,
		period: weeks,
		today,
		stats: await watchStats(k, locals.user!.id, today, weeks, url.searchParams.get('persona'), kind)
	};
};

import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { fixHour, type HourFix } from '#lib/server/plugs/energy-fix.ts';
import { MAX_HOUR_WH } from '#lib/server/plugs/shelly.ts';
import { plugStats } from '#lib/server/plugs/stats.ts';

/** Enchufes → Consumo (#396): ?ver=dia|semana|mes|año, ?dia=YYYY-MM-DD, ?enchufe=its id. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const stats = await plugStats(locals.user!.id, {
		view: url.searchParams.get('ver'),
		day: url.searchParams.get('dia'),
		plugId: url.searchParams.get('enchufe')
	});
	if (!stats) error(404, 'Ese enchufe ya no está');
	return { stats };
};

export const actions: Actions = {
	/** An hour that is wrong: without data, another value (`wh`), or as it came. */
	fix: async ({ request, locals }) => {
		const form = await request.formData();
		const hour = new Date(String(form.get('hour') ?? ''));
		const plugId = String(form.get('plug') ?? '');
		const to = form.get('to');
		if (!plugId || Number.isNaN(hour.getTime())) return fail(400, { message: 'Falta cuál' });
		let fix: HourFix;
		if (to === 'valor') {
			const said = String(form.get('wh') ?? '').trim();
			const wh = /^\d{1,5}([.,]\d{1,2})?$/.test(said) ? Number(said.replace(',', '.')) : NaN;
			if (!(wh >= 0 && wh <= MAX_HOUR_WH))
				return fail(400, { message: `Un valor en Wh, de 0 a ${MAX_HOUR_WH}` });
			fix = { to, wh };
		} else if (to === 'sin_dato' || to === 'original') fix = { to };
		else return fail(400, { message: 'Falta qué hacer' });
		if (!(await withFamily(locals.user!.id, (tx) => fixHour(tx, plugId, hour, fix))))
			return fail(404, { message: 'Esa hora ya no está, o aún no ha terminado' });
	}
};

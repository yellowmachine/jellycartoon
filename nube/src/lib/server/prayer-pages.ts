import { error } from '@sveltejs/kit';
import { kitchenOf } from '#lib/server/fridge.ts';
import { prayerModeOn } from '#lib/server/prayers.ts';

/** The family's kitchen for Oración's pages and actions (#339): not there while it is off. */
export async function prayerKitchen(locals: App.Locals) {
	const k = await kitchenOf(locals.user!.id);
	if (!(await prayerModeOn(k))) error(404, 'Oración no está encendida (Ajustes → Familia)');
	return k;
}

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { houseLink } from '#lib/server/house.ts';
import { isGuardian } from '#lib/server/kid-login.ts';

/**
 * «Leer un QR»: a child's on its device (#303), for who lets some child in; and the house's TV's
 * (jellycartoon's #172, its /entrar), for an adult of a family whose house says its address (Ajustes
 * → Conexiones → Tu casa). Only those: any other link is not followed.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [guardian, house] = await Promise.all([
		isGuardian(await kitchenOf(userId)),
		houseLink(userId)
	]);
	let houseOrigin: string | null = null;
	try {
		houseOrigin = house?.webUrl ? new URL(house.webUrl).origin : null;
	} catch {
		// Not an address: no TV's QR.
	}
	if (!guardian && !house) error(404, 'No hay ningún QR que leer');
	return { guardian, houseOrigin, hasHouse: Boolean(house) };
};

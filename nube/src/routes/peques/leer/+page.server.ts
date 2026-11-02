import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { isGuardian } from '#lib/server/kid-login.ts';

/** «Leer el QR de un peque» (#303): for an adult who lets some child in. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!(await isGuardian(await kitchenOf(locals.user!.id))))
		error(404, 'No tienes peques a los que dejar entrar');
};

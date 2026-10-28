import type { PageServerLoad } from './$types';
import { houseLink } from '#lib/server/house.ts';
import { NoFamily } from '#lib/server/family.ts';

export const load: PageServerLoad = async ({ locals }) => {
	try {
		return { house: await houseLink(locals.user!.id) };
	} catch (error) {
		if (error instanceof NoFamily) return { house: null };
		throw error;
	}
};

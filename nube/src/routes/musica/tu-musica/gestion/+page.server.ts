import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { indexMusic, management, retryCovers } from '#lib/server/own-music.ts';

/**
 * Gestión of «Tu música» (#534), as the house's: how the reading of the bucket goes, the files
 * that could not be read, and the covers. Its administrator's, who can read it again.
 */
async function adminFamily(userId: string) {
	const m = await withFamily(userId, async (_, m) => m);
	return m.role === 'admin' ? m.familyId : null;
}

export const load: PageServerLoad = async ({ locals }) => {
	const familyId = await adminFamily(locals.user!.id);
	if (!familyId) error(403, 'Solo quien administra la familia');
	return { management: await management(familyId) };
};

export const actions: Actions = {
	index: async ({ locals }) => {
		const familyId = await adminFamily(locals.user!.id);
		if (!familyId) return fail(403, { problem: 'Solo quien administra la familia' });
		void indexMusic(familyId);
		return { ok: true };
	},
	covers: async ({ locals }) => {
		const familyId = await adminFamily(locals.user!.id);
		if (!familyId) return fail(403, { problem: 'Solo quien administra la familia' });
		await retryCovers(familyId);
		return { ok: true };
	}
};

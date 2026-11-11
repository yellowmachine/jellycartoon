import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	companionPause,
	companionResume,
	companionSeen,
	companionsFor,
	type PauseFor
} from '#lib/server/companion.ts';

/**
 * «Compañía» (#469), from a linked family: how each person who lives alone and has it on is doing
 * (✓ and ✗ only), and «Ya lo he mirado», «Pausar» and «Reanudar». Any adult; a child sees none.
 */
export const load: PageServerLoad = async ({ locals }) => ({
	companions: await companionsFor(locals.user!.id)
});

const PAUSES: PauseFor[] = ['1h', '3h', 'manana'];

export const actions: Actions = {
	seen: async ({ request, locals }) => {
		const familyId = String((await request.formData()).get('familia') ?? '');
		if (!(await companionSeen(locals.user!.id, locals.user!.name, familyId)))
			return fail(404, { problem: 'Esa familia no está vinculada con la tuya' });
		return { done: 'seen' };
	},
	pause: async ({ request, locals }) => {
		const form = await request.formData();
		const familyId = String(form.get('familia') ?? '');
		const length = String(form.get('length') ?? '') as PauseFor;
		if (!PAUSES.includes(length)) return fail(400, { problem: 'Pausa no válida' });
		if (!(await companionPause(locals.user!.id, locals.user!.name, familyId, length)))
			return fail(404, { problem: 'Esa familia no está vinculada con la tuya' });
		return { done: 'pause' };
	},
	resume: async ({ request, locals }) => {
		const familyId = String((await request.formData()).get('familia') ?? '');
		if (!(await companionResume(locals.user!.id, familyId)))
			return fail(404, { problem: 'Esa familia no está vinculada con la tuya' });
		return { done: 'resume' };
	}
};

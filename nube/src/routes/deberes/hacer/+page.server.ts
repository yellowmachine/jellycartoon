import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { homeworkToDo } from '#lib/server/homework.ts';
import { isKidAccount } from '#lib/server/kids.ts';

/** A child's homework to do (#142): given and not finished. The grown-ups, to theirs. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!(await isKidAccount(locals.user!.id))) redirect(303, '/deberes');
	return { homework: await homeworkToDo(await kitchenOf(locals.user!.id), locals.user!.id) };
};

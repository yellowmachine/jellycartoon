import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	deleteList,
	getActiveList,
	getList,
	moveInList,
	removeFromList,
	renameList,
	restartList,
	setActiveList
} from '#lib/server/lists.ts';
import { getSettings } from '#lib/server/settings.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const userId = locals.user!.id;
	const [list, active, settings] = await Promise.all([
		getList(userId, Number(params.id)),
		getActiveList(userId),
		getSettings(userId)
	]);
	if (!list) error(404, 'Lista no encontrada');
	return { list, active: active?.id === list.id, settings };
};

async function episodeId(request: Request) {
	return Number((await request.formData()).get('episodeId'));
}

export const actions: Actions = {
	rename: async ({ params, request, locals }) => {
		const name = String((await request.formData()).get('title') ?? '').trim();
		if (!name) return fail(400, { message: 'El nombre no puede estar vacío' });
		await renameList(locals.user!.id, Number(params.id), name);
	},
	activate: async ({ params, locals }) => {
		await setActiveList(locals.user!.id, Number(params.id));
	},
	restart: async ({ params, locals }) => {
		await restartList(locals.user!.id, Number(params.id));
	},
	remove: async ({ params, request, locals }) => {
		await removeFromList(locals.user!.id, Number(params.id), await episodeId(request));
	},
	up: async ({ params, request, locals }) => {
		await moveInList(locals.user!.id, Number(params.id), await episodeId(request), -1);
	},
	down: async ({ params, request, locals }) => {
		await moveInList(locals.user!.id, Number(params.id), await episodeId(request), 1);
	},
	delete: async ({ params, locals }) => {
		await deleteList(locals.user!.id, Number(params.id));
		redirect(303, '/lists');
	}
};

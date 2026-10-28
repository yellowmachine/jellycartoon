import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import {
	changePlaylist,
	deletePlaylist,
	playlist,
	type PlaylistChange
} from '#lib/server/music.ts';

const whoOf = (locals: App.Locals) => ({ id: locals.user!.id, email: locals.user!.email });

/** A playlist of the house's (#253), with each item's place, to reorder and remove. */
export const load: PageServerLoad = async ({ params, locals }) => {
	try {
		return { playlist: await playlist(whoOf(locals), Number(params.id)) };
	} catch (err) {
		if (err instanceof HouseProblem) error(404, err.message);
		throw err;
	}
};

/** At home, as its own page does there; why not, said. */
async function change(locals: App.Locals, id: number, what: PlaylistChange) {
	try {
		await changePlaylist(whoOf(locals), id, what);
	} catch (err) {
		if (!(err instanceof HouseProblem)) throw err;
		return fail(502, { message: err.message });
	}
}

async function itemId(request: Request) {
	return Number((await request.formData()).get('itemId'));
}

export const actions: Actions = {
	rename: async ({ params, request, locals }) => {
		const name = String((await request.formData()).get('title') ?? '').trim();
		if (!name) return fail(400, { message: 'El nombre no puede estar vacío' });
		return change(locals, Number(params.id), { action: 'rename', name: name.slice(0, 100) });
	},
	delete: async ({ params, locals }) => {
		try {
			await deletePlaylist(whoOf(locals), Number(params.id));
		} catch (err) {
			if (!(err instanceof HouseProblem)) throw err;
			return fail(502, { message: err.message });
		}
		redirect(303, '/musica/listas');
	},
	remove: async ({ params, request, locals }) =>
		change(locals, Number(params.id), { action: 'remove', itemId: await itemId(request) }),
	up: async ({ params, request, locals }) =>
		change(locals, Number(params.id), { action: 'up', itemId: await itemId(request) }),
	down: async ({ params, request, locals }) =>
		change(locals, Number(params.id), { action: 'down', itemId: await itemId(request) })
};

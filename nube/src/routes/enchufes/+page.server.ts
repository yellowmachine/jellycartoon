import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { PlugOffline } from '#lib/server/plugs/hub.ts';
import {
	createPlug,
	deletePlug,
	listPlugs,
	renewPlugToken,
	switchPlug,
	updatePlug
} from '#lib/server/plugs/plugs.ts';
import { isPlugKind, MAX_PLUG_NAME, plugAddress } from '#lib/plugs.ts';

/** Enchufes (#396): the family's smart plugs, on and off, and what they use. */
export const load: PageServerLoad = async ({ locals }) => ({
	plugs: await listPlugs(locals.user!.id)
});

const nameAndKind = (form: FormData) => {
	const name = String(form.get('name') ?? '').trim();
	const kind = form.get('kind');
	if (!isPlugKind(kind)) return { problem: 'Elige qué hay enchufado' } as const;
	if (name.length > MAX_PLUG_NAME) return { problem: `Hasta ${MAX_PLUG_NAME} letras` } as const;
	return { name, kind } as const;
};

export const actions: Actions = {
	/** A new plug: its address, with its token, shown once. */
	add: async ({ request, locals, url }) => {
		const got = nameAndKind(await request.formData());
		if ('problem' in got) return fail(400, { problem: got.problem });
		const { id, token } = await createPlug(locals.user!.id, got.name, got.kind);
		return { address: { id, kind: got.kind, url: plugAddress(url.origin, token) } };
	},
	/** On or off. Not connected, it says so. */
	switch: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		try {
			if (!(await switchPlug(locals.user!.id, id, form.get('on') === 'true')))
				return fail(404, { problem: 'Ese enchufe ya no está' });
		} catch (e) {
			if (e instanceof PlugOffline)
				return fail(409, { switchProblem: id, problem: 'El enchufe no está conectado' });
			throw e;
		}
		return { switched: id };
	},
	save: async ({ request, locals }) => {
		const form = await request.formData();
		const got = nameAndKind(form);
		if ('problem' in got) return fail(400, { problem: got.problem });
		await updatePlug(locals.user!.id, String(form.get('id') ?? ''), got.name, got.kind);
		return { saved: true };
	},
	/** A new address, the old one no longer valid. */
	renew: async ({ request, locals, url }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const token = await renewPlugToken(locals.user!.id, id);
		if (!token) return fail(404, { problem: 'Ese enchufe ya no está' });
		const kind = form.get('kind');
		return {
			address: { id, kind: isPlugKind(kind) ? kind : 'otro', url: plugAddress(url.origin, token) }
		};
	},
	remove: async ({ request, locals }) => {
		await deletePlug(locals.user!.id, String((await request.formData()).get('id') ?? ''));
		return { removed: true };
	}
};

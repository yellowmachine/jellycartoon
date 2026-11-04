import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parsePaperInput } from 'comun/papers.ts';
import { kmsOn } from '#lib/server/family-secret.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import {
	addPaper,
	deletePaper,
	familyPapers,
	MAX_PAPER_BYTES,
	NotAPaper,
	updatePaper
} from '#lib/server/papers.ts';
import { storageReady } from '#lib/server/storage.ts';

/** Papeles (#384): the family's, sealed; only with the KMS and somewhere to keep the files. */
const ready = () => kmsOn && storageReady;

export const load: PageServerLoad = async ({ locals }) => {
	if (!ready()) return { ready: false, papers: [] };
	return { ready: true, papers: await familyPapers(await kitchenOf(locals.user!.id)) };
};

export const actions: Actions = {
	/** New, with its file; or corrected (with `id`), its file changed only if one is sent. */
	save: async ({ request, locals }) => {
		if (!ready()) return fail(503, { message: 'Papeles no está disponible ahora' });
		const k = await kitchenOf(locals.user!.id);
		const form = await request.formData();
		const input = parsePaperInput({
			name: form.get('name'),
			category: form.get('category'),
			notes: form.get('notes')
		});
		if (!input) return fail(400, { message: 'Falta el nombre o la categoría' });
		const sent = form.get('fichero');
		const file =
			sent instanceof File && sent.size ? new Uint8Array(await sent.arrayBuffer()) : null;
		if (file && file.length > MAX_PAPER_BYTES)
			return fail(413, { message: 'El fichero pasa de 10 MB' });
		const id = Number(form.get('id'));
		if (!id && !file) return fail(400, { message: 'Falta el fichero' });
		try {
			if (id) {
				if (!(await updatePaper(k, id, input, file)))
					return fail(404, { message: 'Ese papel ya no está' });
				return { saved: id };
			}
			return { saved: await addPaper(k, input, file!) };
		} catch (err) {
			if (err instanceof NotAPaper) return fail(400, { message: err.message });
			console.error('[papeles] No se pudo guardar', String(err));
			return fail(503, { message: 'No se ha podido cifrar ni guardar. Prueba en un rato' });
		}
	},
	delete: async ({ request, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		await deletePaper(k, Number((await request.formData()).get('id')));
	}
};

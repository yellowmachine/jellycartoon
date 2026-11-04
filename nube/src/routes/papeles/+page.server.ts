import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parsePaperInput } from 'comun/papers.ts';
import { agendaPeople } from '#lib/server/agenda/agenda.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import {
	addPaper,
	deletePaper,
	familyPapers,
	linkPaper,
	MAX_PAPER_BYTES,
	NotAPaper,
	papersReady,
	unlinkPaper,
	updatePaper
} from '#lib/server/papers.ts';

/** Papeles (#384): the family's, sealed. The agenda's events post their papers here too (#399). */
export const load: PageServerLoad = async ({ locals }) => {
	if (!papersReady()) return { ready: false, papers: [], people: [] };
	const k = await kitchenOf(locals.user!.id);
	const [papers, people] = await Promise.all([familyPapers(k), agendaPeople(k)]);
	return { ready: true, papers, people };
};

export const actions: Actions = {
	/**
	 * New, with its file (with `event`, of that event of the agenda); or corrected (with `id`), its
	 * file changed only if one is sent.
	 */
	save: async ({ request, locals }) => {
		if (!papersReady()) return fail(503, { message: 'Papeles no está disponible ahora' });
		const k = await kitchenOf(locals.user!.id);
		const form = await request.formData();
		const input = parsePaperInput({
			name: form.get('name'),
			category: form.get('category'),
			notes: form.get('notes'),
			people: form.getAll('people')
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
			const saved = await addPaper(k, input, file!);
			const event = Number(form.get('event'));
			// Its event deleted meanwhile: the paper is kept all the same, in Papeles.
			if (event) await linkPaper(k, saved, event);
			return { saved };
		} catch (err) {
			if (err instanceof NotAPaper) return fail(400, { message: err.message });
			console.error('[papeles] No se pudo guardar', String(err));
			return fail(503, { message: 'No se ha podido cifrar ni guardar. Prueba en un rato' });
		}
	},
	delete: async ({ request, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		await deletePaper(k, Number((await request.formData()).get('id')));
	},
	/** One already here, in that event of the agenda too (#399). */
	link: async ({ request, locals }) => {
		const form = await request.formData();
		const linked = await linkPaper(
			await kitchenOf(locals.user!.id),
			Number(form.get('id')),
			Number(form.get('event'))
		);
		if (!linked) return fail(404, { message: 'Ese papel o esa cita ya no están' });
	},
	/** Out of that event; the paper stays here. */
	unlink: async ({ request, locals }) => {
		const form = await request.formData();
		await unlinkPaper(
			await kitchenOf(locals.user!.id),
			Number(form.get('id')),
			Number(form.get('event'))
		);
	}
};

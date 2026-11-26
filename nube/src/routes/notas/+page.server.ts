import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import {
	addWebNote,
	addWrittenNote,
	deleteNote,
	editNote,
	hearAgain,
	listNotes,
	NotAPhoto,
	noteTags,
	setNoteTags,
	shareNote
} from '#lib/server/notes.ts';
import { linkOf } from '#lib/server/wishes.ts';
import { NOTE_KINDS, parseTags } from '#lib/notes.ts';
import { deleteWalkPhoto, listWalkPhotos } from '#lib/server/walks/walks.ts';
import { photoMoment } from '#lib/notes.ts';
import { isLngLat } from 'comun/road.ts';
import { refused } from '#lib/server/storage.ts';
import { MAX_NOTE_PHOTO_BYTES } from '#lib/notes.ts';

/**
 * Notas (#416): one's own and those of the whole house, the latest first, by tabs: said (the
 * default), `?foto`, `?texto` and `?leer`, «Para leer» (#634), the webs saved to read later. `?q=`,
 * searched in all of them; `?casa`, only the house's; `?etiqueta=`, those with that tag.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const q = url.searchParams.get('q')?.trim() || null;
	const kind = NOTE_KINDS.find((k) => url.searchParams.has(k)) ?? 'voz';
	const house = url.searchParams.has('casa');
	const tag = url.searchParams.get('etiqueta')?.trim().toLowerCase() || null;
	const k = await kitchenOf(locals.user!.id);
	// The walks' photos (#613), one's own: they say nothing to be searched by, nor have tags.
	const [notes, photos, tags] = await Promise.all([
		listNotes(k, locals.user!.id, q, { house, kind: q ? undefined : kind, tag }),
		kind !== 'foto' || q || house || tag ? [] : listWalkPhotos(k),
		noteTags(k, locals.user!.id)
	]);
	return { notes, photos, q, kind, house, tag, tags };
};

const idOf = (form: FormData) => {
	const id = Number(form.get('id'));
	return Number.isInteger(id) ? id : null;
};

export const actions: Actions = {
	write: async ({ request, locals }) => {
		const form = await request.formData();
		const file = form.get('photo');
		const photo = file instanceof File && file.size ? file : null;
		if (photo && photo.size > MAX_NOTE_PHOTO_BYTES)
			return fail(413, { message: 'La foto es demasiado grande' });
		const position: [number, number] = [Number(form.get('lon')), Number(form.get('lat'))];
		const k = await kitchenOf(locals.user!.id);
		try {
			const id = await addWrittenNote(k, locals.user!.id, {
				text: String(form.get('text') ?? ''),
				photo: photo && new Uint8Array(await photo.arrayBuffer()),
				shared: form.has('shared'),
				at: photo ? photoMoment(Number(form.get('at'))) : null,
				position: photo && form.has('lon') && isLngLat(position) ? position : null,
				tags: parseTags(String(form.get('tags') ?? ''))
			});
			if (!id) return fail(400, { message: 'Una nota necesita algo escrito o una foto' });
		} catch (err) {
			if (err instanceof NotAPhoto) return fail(415, { message: err.message });
			const no = refused(err);
			if (no) return fail(no.status, { message: no.message });
			throw err;
		}
	},
	edit: async ({ request, locals }) => {
		const form = await request.formData();
		const id = idOf(form);
		const text = String(form.get('text') ?? '').trim();
		if (!id || !text) return fail(400, { message: 'Una nota necesita algo escrito' });
		const k = await kitchenOf(locals.user!.id);
		if (!(await editNote(k, locals.user!.id, id, text)))
			return fail(404, { message: 'Esa nota ya no está' });
		await setNoteTags(k, locals.user!.id, id, parseTags(String(form.get('tags') ?? '')));
	},
	/** «Para leer» (#634): a web pasted, saved with its article if it can be read. */
	link: async ({ request, locals }) => {
		const form = await request.formData();
		const link = linkOf(form.get('url'));
		if (!link) return fail(400, { message: 'Eso no es un enlace' });
		const { read } = await addWebNote(await kitchenOf(locals.user!.id), locals.user!.id, {
			link,
			title: '',
			tags: parseTags(String(form.get('tags') ?? ''))
		});
		return {
			saved: read
				? 'Guardada para leer.'
				: 'Guardada, pero esa web no deja leerla desde Seilide: queda el enlace.'
		};
	},
	/** Shown to the whole house (`shared`), or only to its person again. */
	share: async ({ request, locals }) => {
		const form = await request.formData();
		const id = idOf(form);
		const k = await kitchenOf(locals.user!.id);
		if (!id || !(await shareNote(k, locals.user!.id, id, form.get('shared') === '1')))
			return fail(404, { message: 'Esa nota ya no está' });
	},
	delete: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (id) await deleteNote(await kitchenOf(locals.user!.id), locals.user!.id, id);
	},
	/** A walk's photo (#613). */
	deletePhoto: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (id) await deleteWalkPhoto(await kitchenOf(locals.user!.id), id);
	},
	/** One that could not be heard, again. */
	hear: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		const who = { id: locals.user!.id, email: locals.user!.email };
		if (!id || !(await hearAgain(await kitchenOf(who.id), who, id)))
			return fail(404, { message: 'Esa nota ya no está' });
	}
};

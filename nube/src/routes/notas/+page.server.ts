import { error, fail } from '@sveltejs/kit';
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
	noteArticle,
	noteTags,
	setNoteTags,
	shareNote
} from '#lib/server/notes.ts';
import { linkOf } from '#lib/server/wishes.ts';
import { notesTabOf, onlyLink, parseTags } from '#lib/notes.ts';
import { deleteWalkPhoto, listWalkPhotos } from '#lib/server/walks/walks.ts';
import { photoMoment } from '#lib/notes.ts';
import { isLngLat } from 'comun/road.ts';
import { refused } from '#lib/server/storage.ts';
import { safeArticleHtml } from '#lib/server/notes-reader.ts';
import { MAX_NOTE_PHOTO_BYTES } from '#lib/notes.ts';

/**
 * Notas (#416): one's own and those of the whole house, the latest first, by tabs: said (the
 * default), `?foto` and `?texto`, Textos: the written ones and the webs saved to read later («Para
 * leer», #634), `&solo=notas` or `&solo=leer` (the old `?leer`). `?q=`, searched in all of them;
 * `?casa`, only the house's; `?etiqueta=`, those with that tag. `?ver=`, one read whole, in its tab
 * (`&sin`, a web just saved that cannot be read).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const q = url.searchParams.get('q')?.trim() || null;
	const { kind, only } = notesTabOf(url.searchParams);
	const house = url.searchParams.has('casa');
	const tag = url.searchParams.get('etiqueta')?.trim().toLowerCase() || null;
	const userId = locals.user!.id;
	const k = await kitchenOf(userId);
	const seenId = Number(url.searchParams.get('ver'));
	if (Number.isInteger(seenId) && seenId > 0) {
		const found = await noteArticle(k, userId, seenId);
		if (!found) error(404, 'Esa nota ya no está');
		const article = found.article && {
			...found.article,
			html: safeArticleHtml(found.article.html),
			text: ''
		};
		const seen = { note: found.note, article, justSaved: url.searchParams.has('sin') };
		const tags = await noteTags(k, userId);
		return { notes: [], photos: [], q, kind, only, house, tag, tags, seen };
	}
	// The walks' photos (#613), one's own: they say nothing to be searched by, nor have tags.
	const [notes, photos, tags] = await Promise.all([
		listNotes(k, userId, q, q ? { house, tag } : { house, kind, only, tag }),
		kind !== 'foto' || q || house || tag ? [] : listWalkPhotos(k),
		noteTags(k, userId)
	]);
	return { notes, photos, q, kind, only, house, tag, tags, seen: null };
};

const idOf = (form: FormData) => {
	const id = Number(form.get('id'));
	return Number.isInteger(id) ? id : null;
};

export const actions: Actions = {
	/**
	 * Written by hand, with a photo or without; only a web's address, saved to read later
	 * («Para leer», #634), with its article if it can be read.
	 */
	write: async ({ request, locals }) => {
		const form = await request.formData();
		const file = form.get('photo');
		const photo = file instanceof File && file.size ? file : null;
		const web = !photo && linkOf(onlyLink(String(form.get('text') ?? '')));
		if (web) {
			const k = await kitchenOf(locals.user!.id);
			const { id, read } = await addWebNote(k, locals.user!.id, {
				link: web,
				title: '',
				tags: parseTags(String(form.get('tags') ?? ''))
			});
			if (form.has('shared')) await shareNote(k, locals.user!.id, id, true);
			return {
				saved: read
					? 'Guardada para leer.'
					: 'Guardada, pero esa web no deja leerla desde Seilide: queda el enlace.'
			};
		}
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

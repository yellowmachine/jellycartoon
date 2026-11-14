import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { recipe } from '#lib/server/db/schema.ts';
import { kindOf } from '#lib/server/expenses/income.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { fetchPublic } from '#lib/server/public-fetch.ts';
import { putFile, removeFile } from '#lib/server/storage.ts';
import { findRecipe, normalizeRecipe, readPage } from './schema-org.ts';
import { searchRecipeSites } from './sites.ts';

/**
 * A recipe's picture: the family's own photo of the dish (kept in their storage), or the one of
 * its page on a cooking site. A recipe written in «Preguntar» (#470) has no page: its picture is
 * looked for on the family's favourite sites, by its name, as a site's recipe of the same dish.
 */

/** In the family's storage. */
export const RECIPE_PHOTOS = 'recetas';

const USER_AGENT = 'Seilide/1.0 (https://github.com/yellowmachine/jellycartoon)';
const MAX_PAGE_BYTES = 5_000_000;
/** Pages of the favourite sites tried, best match first. */
const TRIES = 3;

const IMAGES = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
} as const;

/** Where its picture is shown from: its own photo first, then the site's; null, none. */
export function pictureOf(r: { id: number; photo: string | null; imageUrl: string | null }) {
	return r.photo ? `/recetas/fotos/${r.id}?v=${r.photo}` : r.imageUrl;
}

/** Thrown for a file that is not a photo. */
export class NotAPhoto extends Error {
	constructor() {
		super('Tiene que ser una foto (JPG, PNG o WebP)');
	}
}

/** The family's photo of the dish, in place of the one before (if any): false, no such recipe. */
export async function setRecipePhoto(k: Kitchen, id: number, file: Uint8Array) {
	const kind = kindOf(file);
	if (!kind || !(kind in IMAGES)) throw new NotAPhoto();
	const [before] = await k.run((tx) =>
		tx.select({ photo: recipe.photo }).from(recipe).where(eq(recipe.id, id))
	);
	if (!before) return false;
	const name = `${randomUUID()}.${IMAGES[kind as keyof typeof IMAGES]}`;
	await putFile(k.familyId, RECIPE_PHOTOS, name, file, kind);
	await k.run((tx) => tx.update(recipe).set({ photo: name }).where(eq(recipe.id, id)));
	await forgetPhoto(k, before.photo);
	return true;
}

/** Its own photo gone: the site's picture again, if it has one. */
export async function removeRecipePhoto(k: Kitchen, id: number) {
	const [before] = await k.run((tx) =>
		tx.select({ photo: recipe.photo }).from(recipe).where(eq(recipe.id, id))
	);
	if (!before?.photo) return;
	await k.run((tx) => tx.update(recipe).set({ photo: null }).where(eq(recipe.id, id)));
	await forgetPhoto(k, before.photo);
}

export async function forgetPhoto(k: Kitchen, name: string | null) {
	if (!name) return;
	await removeFile(k.familyId, RECIPE_PHOTOS, name).catch((err) =>
		console.warn('[recetas] No se pudo borrar una foto', String(err))
	);
}

/** Its own photo's file, to serve it. */
export async function recipePhotoFile(k: Kitchen, id: number) {
	const [row] = await k.run((tx) =>
		tx.select({ photo: recipe.photo }).from(recipe).where(eq(recipe.id, id))
	);
	return row?.photo ?? null;
}

/**
 * A picture of the dish from the family's favourite sites: the first of the pages found by its
 * name that has one (its Recipe's image, else og:image). Null, none found.
 */
export async function findPicture(k: Kitchen, title: string) {
	const pages = await searchRecipeSites(k, title, undefined, TRIES);
	for (const page of pages) {
		try {
			const fetched = await fetchPublic(page.url, {
				headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
				maxBytes: MAX_PAGE_BYTES
			});
			if (!/html/i.test(fetched.contentType)) continue;
			const read = await readPage(fetched.body);
			const node = findRecipe(read.jsonLd);
			const found = (node && normalizeRecipe(node)?.imageUrl) || read.imageUrl;
			const url = found ? new URL(found, fetched.url) : null;
			if (url && (url.protocol === 'https:' || url.protocol === 'http:')) return url.href;
		} catch (err) {
			console.warn('[recetas] No se pudo leer una página para la foto', {
				url: page.url,
				problem: String(err)
			});
		}
	}
	return null;
}

/**
 * Looks for its picture and puts it, if it still has none (neither its own photo nor the site's):
 * whether it found one.
 */
export async function pictureFromSites(k: Kitchen, id: number, title: string) {
	const url = await findPicture(k, title);
	if (!url) return false;
	await k.run((tx) =>
		tx
			.update(recipe)
			.set({ imageUrl: url })
			.where(and(eq(recipe.id, id), isNull(recipe.imageUrl), isNull(recipe.photo)))
	);
	return true;
}

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { MAX_PHOTO_NOTE } from 'comun/fridge.ts';
import { fridgeItem, shoppingPhoto } from '#lib/server/db/schema.ts';
import { kindOf } from '#lib/server/expenses/income.ts';
import { changed, itemKey, type Kitchen } from '#lib/server/fridge.ts';
import { putFile, removeFile } from '#lib/server/storage.ts';

/**
 * The photos of what is on the shopping list, so that whoever buys it sees which one it is. One per
 * name in each family, remembered when the item goes: on the list again, it has its photo.
 */

/** In the family's storage. */
export const SHOPPING_PHOTOS = 'compra';

const IMAGES = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
} as const;

/** Thrown for a file that is not a photo. */
export class NotAPhoto extends Error {
	constructor() {
		super('Tiene que ser una foto (JPG, PNG o WebP)');
	}
}

/** The item's name as its photo is kept by; null, no longer on the list. */
async function keyOf(k: Kitchen, itemId: number) {
	const [item] = await k.run((tx) =>
		tx.select({ text: fridgeItem.text }).from(fridgeItem).where(eq(fridgeItem.id, itemId))
	);
	return item ? itemKey(item.text) : null;
}

/** An item's photo, in place of the one before (its note stays): false, no such item. */
export async function setShoppingPhoto(k: Kitchen, itemId: number, file: Uint8Array) {
	const kind = kindOf(file);
	if (!kind || !(kind in IMAGES)) throw new NotAPhoto();
	const name = await keyOf(k, itemId);
	if (!name) return false;
	const photo = `${randomUUID()}.${IMAGES[kind as keyof typeof IMAGES]}`;
	await putFile(k.familyId, SHOPPING_PHOTOS, photo, file, kind);
	let before: string | null;
	try {
		before = await k.run(async (tx) => {
			const [old] = await tx
				.select({ photo: shoppingPhoto.photo })
				.from(shoppingPhoto)
				.where(eq(shoppingPhoto.name, name))
				.for('update');
			await tx
				.insert(shoppingPhoto)
				.values({ familyId: k.familyId, name, photo, userId: k.userId })
				.onConflictDoUpdate({
					target: [shoppingPhoto.familyId, shoppingPhoto.name],
					set: { photo, userId: k.userId }
				});
			return old?.photo ?? null;
		});
	} catch (err) {
		await forget(k, photo);
		throw err;
	}
	if (before) await forget(k, before);
	changed(k.familyId);
	return true;
}

/** What is written under an item's photo: false if it has none. */
export async function setPhotoNote(k: Kitchen, itemId: number, note: string) {
	const name = await keyOf(k, itemId);
	if (!name) return false;
	const rows = await k.run((tx) =>
		tx
			.update(shoppingPhoto)
			.set({ note: note.trim().slice(0, MAX_PHOTO_NOTE) })
			.where(eq(shoppingPhoto.name, name))
			.returning({ id: shoppingPhoto.id })
	);
	if (rows.length) changed(k.familyId);
	return rows.length > 0;
}

/** An item's photo gone, and its note with it. */
export async function removeShoppingPhoto(k: Kitchen, itemId: number) {
	const name = await keyOf(k, itemId);
	if (!name) return;
	const rows = await k.run((tx) =>
		tx
			.delete(shoppingPhoto)
			.where(eq(shoppingPhoto.name, name))
			.returning({ photo: shoppingPhoto.photo })
	);
	for (const { photo } of rows) await forget(k, photo);
	if (rows.length) changed(k.familyId);
}

/** A photo's file, to serve it. */
export async function shoppingPhotoFile(k: Kitchen, id: number) {
	if (!Number.isInteger(id)) return null;
	const [row] = await k.run((tx) =>
		tx.select({ photo: shoppingPhoto.photo }).from(shoppingPhoto).where(eq(shoppingPhoto.id, id))
	);
	return row?.photo ?? null;
}

async function forget(k: Kitchen, photo: string) {
	await removeFile(k.familyId, SHOPPING_PHOTOS, photo).catch((err) =>
		console.warn('[nevera] No se pudo borrar una foto', String(err))
	);
}

import { familySettings } from './db/schema.ts';
import type { Kitchen } from './fridge.ts';
import { decrypt, encrypt } from './secret-box.ts';

/** The family's settings row, if it has one. */
const settingsOf = async (k: Kitchen) => {
	const [row] = await k.run((tx) => tx.select().from(familySettings));
	return row ?? null;
};

/**
 * Whose each key is, as it is read: each request's cost is noted for its family (ai-spend.ts),
 * and openrouter.ts only knows the key it asked with.
 */
const keyFamilies = new Map<string, string>();

export const familyOfKey = (key: string) => keyFamilies.get(key) ?? null;

/** Its OpenRouter key, for the AI (recipes); null without one, or if it cannot be read. */
export async function openRouterKey(k: Kitchen) {
	const row = await settingsOf(k);
	const key = row?.openrouterKey ? decrypt(row.openrouterKey) : null;
	if (key) keyFamilies.set(key, k.familyId);
	return key;
}

/** How it starts, for Ajustes: the key itself never leaves the server. */
export async function openRouterKeyStart(k: Kitchen) {
	const key = await openRouterKey(k);
	return key ? `${key.slice(0, 12)}…${key.slice(-4)}` : null;
}

/** A new key, or none (null). */
export async function setOpenRouterKey(k: Kitchen, key: string | null) {
	const openrouterKey = key ? encrypt(key) : null;
	await k.run((tx) =>
		tx
			.insert(familySettings)
			.values({ familyId: k.familyId, openrouterKey })
			.onConflictDoUpdate({ target: familySettings.familyId, set: { openrouterKey } })
	);
}

/** Its openrouteservice key, for the road mode's routes; null without one. */
export async function orsKey(k: Kitchen) {
	const row = await settingsOf(k);
	return row?.orsKey ? decrypt(row.orsKey) : null;
}

/** How it starts, for Ajustes. */
export async function orsKeyStart(k: Kitchen) {
	const key = await orsKey(k);
	return key ? `${key.slice(0, 8)}…${key.slice(-4)}` : null;
}

/** A new key, or none (null). */
export async function setOrsKey(k: Kitchen, key: string | null) {
	const value = key ? encrypt(key) : null;
	await k.run((tx) =>
		tx
			.insert(familySettings)
			.values({ familyId: k.familyId, orsKey: value })
			.onConflictDoUpdate({ target: familySettings.familyId, set: { orsKey: value } })
	);
}

/** The recipe whose picture is behind the book's page; null: none. */
export async function recipesBackdropId(k: Kitchen) {
	return (await settingsOf(k))?.recipesBackdrop ?? null;
}

/** This recipe's picture behind the book's page, or (if it already is) no picture. */
export async function toggleRecipesBackdrop(k: Kitchen, id: number) {
	const recipesBackdrop = (await recipesBackdropId(k)) === id ? null : id;
	await k.run((tx) =>
		tx
			.insert(familySettings)
			.values({ familyId: k.familyId, recipesBackdrop })
			.onConflictDoUpdate({ target: familySettings.familyId, set: { recipesBackdrop } })
	);
}

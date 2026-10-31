import { familySettings } from './db/schema.ts';
import type { Place } from 'comun/weather.ts';
import type { Kitchen } from './fridge.ts';
import { decrypt, encrypt } from './secret-box.ts';
import { NO_CREDIT, rememberBlock, unblock, type Block } from './ai-block.ts';

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
	if (key) {
		keyFamilies.set(key, k.familyId);
		rememberBlock(
			key,
			row?.aiBlockedAt ? { at: row.aiBlockedAt, why: row.aiBlockedWhy ?? NO_CREDIT } : null
		);
	}
	return key;
}

/** How it starts, for Ajustes: the key itself never leaves the server. */
export async function openRouterKeyStart(k: Kitchen) {
	const key = await openRouterKey(k);
	return key ? `${key.slice(0, 12)}…${key.slice(-4)}` : null;
}

/** A new key, or none (null). */
export async function setOpenRouterKey(k: Kitchen, key: string | null) {
	// Another key: the AI stopped with the one before goes on (ai-block.ts).
	const before = await openRouterKey(k);
	if (before) unblock(before);
	const openrouterKey = key ? encrypt(key) : null;
	const set = { openrouterKey, aiBlockedAt: null, aiBlockedWhy: null };
	await k.run((tx) =>
		tx
			.insert(familySettings)
			.values({ familyId: k.familyId, ...set })
			.onConflictDoUpdate({ target: familySettings.familyId, set })
	);
}

/** The family's AI stopped, or going again (null), as ai-block.ts says: kept for a restart. */
export async function keepBlock(k: Kitchen, block: Block | null) {
	const set = { aiBlockedAt: block?.at ?? null, aiBlockedWhy: block?.why ?? null };
	await k.run((tx) =>
		tx
			.insert(familySettings)
			.values({ familyId: k.familyId, ...set })
			.onConflictDoUpdate({ target: familySettings.familyId, set })
	);
}

/** Stopped (ai-block.ts), and why: for the banner of who runs the family; null, going. */
export async function aiBlockOf(k: Kitchen): Promise<Block | null> {
	const row = await settingsOf(k);
	return row?.aiBlockedAt ? { at: row.aiBlockedAt, why: row.aiBlockedWhy ?? NO_CREDIT } : null;
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

/** «Dónde vivís» (Ajustes → Familia), for the weather; null, not said. */
export async function familyPlace(k: Kitchen) {
	return (await settingsOf(k))?.place ?? null;
}

/** Where the family lives, or nowhere (null). */
export async function setFamilyPlace(k: Kitchen, place: Place | null) {
	await k.run((tx) =>
		tx
			.insert(familySettings)
			.values({ familyId: k.familyId, place })
			.onConflictDoUpdate({ target: familySettings.familyId, set: { place } })
	);
}

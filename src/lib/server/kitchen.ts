import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';
import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import { decrypt, encrypt } from '#lib/server/secret-box.ts';
import * as local from '#lib/server/fridge.ts';
import * as localRecipes from '#lib/server/recipes/import.ts';
import { agendaToday } from '#lib/server/agenda/agenda.ts';
import type { FridgeState } from '#lib/fridge.ts';
import type { RecipeStep } from '#lib/recipe.ts';

/**
 * The fridge and the recipe book, at home or in the cloud (#253): with the cloud connected
 * (Ajustes → Casa → «La nube»: its address and the key it gave the house), the voice and the TV
 * use the family's, there (its /api/casa); without it, the house's own, as always. What is said
 * goes in the name of who says it, by their email, when it is known (not a satellite).
 */

export interface CloudLink {
	url: string;
	key: string;
}

/** The cloud's address and key, or null if it is not connected. */
export async function cloudLink(): Promise<CloudLink | null> {
	const [url, key] = await Promise.all([getAppSetting('nube_url'), getAppSetting('nube_key')]);
	const plain = key ? decrypt(key) : null;
	return url && plain ? { url, key: plain } : null;
}

/** Connected (both), or not (null). The key, encrypted. */
export async function setCloudLink(link: CloudLink | null) {
	await Promise.all([
		setAppSetting('nube_url', link?.url ?? null),
		setAppSetting('nube_key', link ? encrypt(link.key) : null)
	]);
}

/** The cloud's address, for the pages that send there: null if it is not connected. */
export const cloudUrl = () => getAppSetting('nube_url');

/** Why the cloud did not answer, said for people (and for the voice's AI). */
export class CloudProblem extends Error {}

async function emailOf(userId: string | null) {
	if (!userId) return null;
	const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
	return row?.email ?? null;
}

/** A request to the cloud's API for houses, in this person's name (or the house's, without one). */
export async function askCloud<T>(
	link: CloudLink,
	path: string,
	{ userId = null, body }: { userId?: string | null; body?: unknown } = {}
): Promise<T> {
	const email = await emailOf(userId);
	let response: Response;
	try {
		response = await fetch(`${link.url}/api/casa${path}`, {
			method: body === undefined ? 'GET' : 'POST',
			headers: {
				'x-api-key': link.key,
				'content-type': 'application/json',
				...(email ? { 'x-persona': email } : {})
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(15_000)
		});
	} catch {
		throw new CloudProblem('No llego a la nube: sin internet, o la nube no contesta');
	}
	if (response.status === 401)
		throw new CloudProblem('La nube no acepta la clave de la casa: ponla otra vez en Ajustes');
	if (!response.ok) {
		const why = await response.json().catch(() => null);
		throw new CloudProblem(why?.message ?? `La nube contestó ${response.status}`);
	}
	return response.json() as Promise<T>;
}

/** The whole fridge, for the TV: the cloud's, with the house's agenda of today on it. */
export async function fridgeState(): Promise<FridgeState> {
	const link = await cloudLink();
	if (!link) return local.fridgeState();
	const [{ fridge }, today] = await Promise.all([
		askCloud<{ fridge: Omit<FridgeState, 'today'> }>(link, '/nevera'),
		agendaToday()
	]);
	return { ...fridge, today };
}

/**
 * For the TV and its live updates: without the cloud (no internet), an empty fridge with the
 * agenda, rather than the TV's page failing.
 */
export async function fridgeForScreen(): Promise<FridgeState> {
	try {
		return await fridgeState();
	} catch (error) {
		if (!(error instanceof CloudProblem)) throw error;
		return { notes: [], list: { id: 0, items: [] }, today: await agendaToday() };
	}
}

/**
 * Who it goes as in the cloud: the person, or the house from a satellite (where anyone may speak).
 * At home, as always: the satellite's owner.
 */
const speaker = (userId: string, satellite: boolean) => (satellite ? null : userId);

/** Onto the shopping list; returns what was added. */
export async function addItems(userId: string, items: string[], satellite = false) {
	const link = await cloudLink();
	if (!link) return local.addItems(userId, items);
	const { added } = await askCloud<{ added: string[] }>(link, '/nevera', {
		userId: speaker(userId, satellite),
		body: { action: 'add', items }
	});
	return added;
}

/** What is left to buy. */
export async function toBuy() {
	const link = await cloudLink();
	if (!link) return local.toBuy();
	return (await askCloud<{ toBuy: string[] }>(link, '/nevera')).toBuy;
}

/** An item off the list by its name; null if it is not there. */
export async function tickOffByName(text: string, userId: string | null) {
	const link = await cloudLink();
	if (!link) return local.tickOffByName(text, userId);
	const { ticked } = await askCloud<{ ticked: string | null }>(link, '/nevera', {
		userId,
		body: { action: 'tick', text }
	});
	return ticked;
}

/** A post-it, until that day or until peeled off. */
export async function addNote(
	userId: string,
	text: string,
	until: string | null,
	satellite = false
) {
	const link = await cloudLink();
	if (!link) return local.addNote(userId, text, until);
	await askCloud(link, '/nevera', {
		userId: speaker(userId, satellite),
		body: { action: 'note', text, until }
	});
}

export interface SavedRecipe {
	id: number;
	title: string;
	servings: number | null;
	ingredients: string[];
	steps: RecipeStep[];
	sourceName: string;
}

/** The book, by title: what the voice knows it can cook. */
export async function listRecipes(): Promise<{ id: number; title: string; sourceName: string }[]> {
	const link = await cloudLink();
	if (!link) return localRecipes.listRecipes();
	return (
		await askCloud<{ recipes: { id: number; title: string; sourceName: string }[] }>(
			link,
			'/recetas'
		)
	).recipes;
}

/** One recipe, to cook it; null if it is not in the book. */
export async function getRecipe(id: number): Promise<SavedRecipe | null> {
	const link = await cloudLink();
	if (!link) return localRecipes.getRecipe(id);
	try {
		return (await askCloud<{ recipe: SavedRecipe }>(link, `/recetas/${id}`)).recipe;
	} catch (error) {
		if (error instanceof CloudProblem && /no encontrada/i.test(error.message)) return null;
		throw error;
	}
}

/** A recipe saved from a web page, in the book; its id. */
export async function importRecipe(url: string, userId: string, satellite = false) {
	const link = await cloudLink();
	if (!link) return localRecipes.importRecipe(url, userId);
	return askCloud<{ id: number; existing: boolean }>(link, '/recetas', {
		userId: speaker(userId, satellite),
		body: { url }
	});
}

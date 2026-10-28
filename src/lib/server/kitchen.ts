import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';
import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import { decrypt, encrypt } from '#lib/server/secret-box.ts';
import { agendaToday } from '#lib/server/agenda/agenda.ts';
import type { FridgeState } from '#lib/fridge.ts';
import type { RecipeStep } from '#lib/recipe.ts';
import type { ExpenseDraft, ExpenseFavorite, ExpenseInput } from 'comun/expenses.ts';

/**
 * The fridge, the recipe book and the expenses, which live in the cloud (#253): the family's,
 * there (its /api/casa), with its address and the key it gave the house (Ajustes → Casa → «La
 * nube»). The voice, the TV and the road mode use them from here. What is said goes in the name of
 * who says it, by their email, when it is known (not a satellite).
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

export async function linked() {
	const link = await cloudLink();
	if (!link)
		throw new CloudProblem(
			'La nevera, las recetas y los gastos están en la nube, y no está conectada: Ajustes → Casa → «La nube»'
		);
	return link;
}

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
	const [{ fridge }, today] = await Promise.all([
		askCloud<{ fridge: Omit<FridgeState, 'today'> }>(await linked(), '/nevera'),
		agendaToday()
	]);
	return { ...fridge, today };
}

/**
 * For the TV and its live updates: without the cloud (not connected, no internet), an empty fridge
 * with the agenda, rather than the TV's page failing.
 */
export async function fridgeForScreen(): Promise<FridgeState> {
	try {
		return await fridgeState();
	} catch (error) {
		if (!(error instanceof CloudProblem)) throw error;
		return { notes: [], list: { id: 0, items: [] }, today: await agendaToday() };
	}
}

/** Who it goes as in the cloud: the person, or the house from a satellite (where anyone may speak). */
const speaker = (userId: string, satellite: boolean) => (satellite ? null : userId);

/** Onto the shopping list; returns what was added. */
export async function addItems(userId: string, items: string[], satellite = false) {
	const { added } = await askCloud<{ added: string[] }>(await linked(), '/nevera', {
		userId: speaker(userId, satellite),
		body: { action: 'add', items }
	});
	return added;
}

/** What is left to buy. */
export async function toBuy() {
	return (await askCloud<{ toBuy: string[] }>(await linked(), '/nevera')).toBuy;
}

/** An item off the list by its name; null if it is not there. */
export async function tickOffByName(text: string, userId: string | null) {
	const { ticked } = await askCloud<{ ticked: string | null }>(await linked(), '/nevera', {
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
	await askCloud(await linked(), '/nevera', {
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

/** The book, by title, and the favourite sites: what the voice can cook, and where to look. */
export async function recipeBook() {
	return askCloud<{
		recipes: { id: number; title: string; sourceName: string }[];
		sites: { id: number; name: string; host: string }[];
	}>(await linked(), '/recetas');
}

/** One recipe, to cook it; null if it is not in the book. */
export async function getRecipe(id: number): Promise<SavedRecipe | null> {
	try {
		return (await askCloud<{ recipe: SavedRecipe }>(await linked(), `/recetas/${id}`)).recipe;
	} catch (error) {
		if (error instanceof CloudProblem && /no encontrada/i.test(error.message)) return null;
		throw error;
	}
}

/** The favourite sites' pages for a dish (or in one site): title, site and address of each. */
export async function searchRecipeSites(query: string, siteId?: number) {
	const params = new URLSearchParams({ q: query, ...(siteId ? { web: String(siteId) } : {}) });
	return (
		await askCloud<{ results: { url: string; title: string; site: string }[] }>(
			await linked(),
			`/recetas/buscar?${params}`
		)
	).results;
}

/** A favourite site's recipe saved in the book (the cloud checks it is one); its id. */
export async function importRecipe(url: string, userId: string, satellite = false) {
	return askCloud<{ id: number; existing: boolean }>(await linked(), '/recetas', {
		userId: speaker(userId, satellite),
		body: { url }
	});
}

/** The family's favourite expenses («el café de siempre»). */
export async function favoriteExpenses() {
	return (await askCloud<{ favorites: ExpenseFavorite[] }>(await linked(), '/gastos')).favorites;
}

/**
 * An expense in the family's Gastos: by voice, or the road mode's fuel (typed, or from a receipt
 * read with `readReceipt`). In the name of who said it; from a satellite, the house's.
 */
export async function addExpense(
	userId: string,
	expense: ExpenseInput,
	source: 'voz' | 'mano' | 'ticket',
	{ receipt = null, satellite = false }: { receipt?: string | null; satellite?: boolean } = {}
) {
	return askCloud<{ id: number }>(await linked(), '/gastos', {
		userId: speaker(userId, satellite),
		body: { expense, source, receipt }
	});
}

/** A receipt's photo read by the family's AI in the cloud: what it says, and its waiting file. */
export async function readReceipt(photo: Blob, userId: string) {
	const link = await linked();
	const email = await emailOf(userId);
	let response: Response;
	try {
		// The photo itself as the body: a form from a server is refused by SvelteKit's CSRF check.
		response = await fetch(`${link.url}/api/casa/gastos/leer`, {
			method: 'POST',
			headers: {
				'x-api-key': link.key,
				'content-type': 'image/jpeg',
				...(email ? { 'x-persona': email } : {})
			},
			body: photo,
			signal: AbortSignal.timeout(150_000)
		});
	} catch {
		throw new CloudProblem('No llego a la nube: sin internet, o la nube no contesta');
	}
	const body = await response.json().catch(() => null);
	if (!response.ok) throw new CloudProblem(body?.message ?? `La nube contestó ${response.status}`);
	return body as ExpenseDraft;
}

import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';
import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import { log } from '#lib/server/log.ts';
import { decrypt, encrypt } from '#lib/server/secret-box.ts';
import { localDay } from 'comun/agenda.ts';
import type { AlarmPlace } from 'comun/alarms.ts';
import type { FridgeState } from 'comun/fridge.ts';
import type { RecipeStep } from '#lib/recipe.ts';
import type { ExpenseDraft, ExpenseFavorite, ExpenseInput } from 'comun/expenses.ts';

/**
 * The fridge, the recipe book, the expenses, the agenda and the alarms, which live in the cloud
 * (#253): the family's, there (its /api/casa), with its address and the key it gave the house
 * (Ajustes → Casa → «La nube»). The voice, the TV and the road mode use them from here. What is said goes in the name of
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
			'La nevera, las recetas, los gastos, la agenda y las alarmas están en la nube, y no está conectada: Ajustes → Casa → «La nube»'
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

/** The whole fridge, for the TV: the cloud's, with the agenda's «Hoy» on it. */
export async function fridgeState(): Promise<FridgeState> {
	return (await askCloud<{ fridge: FridgeState }>(await linked(), '/nevera')).fridge;
}

/**
 * For the TV and its live updates: without the cloud (not connected, no internet), an empty fridge,
 * rather than the TV's page failing.
 */
export async function fridgeForScreen(): Promise<FridgeState> {
	try {
		return await fridgeState();
	} catch (error) {
		if (!(error instanceof CloudProblem)) throw error;
		return {
			notes: [],
			list: { id: 0, items: [] },
			today: { day: localDay(), events: [], people: [] }
		};
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

// ——— The agenda and the alarms (#200, #241) ———

/** What the voice's AI asked of the agenda (add_event, agenda), done there; what to tell it. */
export async function agendaByVoice(
	userId: string,
	action: 'add' | 'read',
	args: Record<string, unknown>,
	{ satellite = false, kid = null }: { satellite?: boolean; kid?: string | null } = {}
) {
	return (
		await askCloud<{ say: string }>(await linked(), '/agenda', {
			userId: speaker(userId, satellite),
			body: { action, args, kid }
		})
	).say;
}

/**
 * What the voice's AI asked of the alarms (set_alarm, change_alarm), done there, where it is said
 * (`place`, a satellite's; null, a phone); what to tell it.
 */
export async function alarmByVoice(
	userId: string,
	action: 'set' | 'change',
	args: Record<string, unknown>,
	place: AlarmPlace | null
) {
	return (
		await askCloud<{ say: string }>(await linked(), '/alarmas', {
			userId: speaker(userId, place !== null),
			body: { action, args, place }
		})
	).say;
}

/**
 * The family's alarms the voice may see, as lines for its AI (the house's and, from a phone, its
 * person's); without the cloud, said so.
 */
export async function cloudAlarmLines(
	place: AlarmPlace | null,
	userId: string | null,
	satellites: { id: string; name: string }[]
) {
	try {
		return (
			await askCloud<{ lines: string[] }>(await linked(), '/alarmas', {
				userId: place ? null : userId,
				body: {
					action: 'describe',
					place,
					satellites: satellites.map(({ id, name }) => ({ id, name }))
				}
			})
		).lines;
	} catch (error) {
		if (!(error instanceof CloudProblem)) throw error;
		return [`(las alarmas no se pueden ver: ${error.message})`];
	}
}

/** One of the cloud's alarms stopped here: the cloud is told (it may be put off then). */
export async function cloudAlarmStopped(cloudId: number) {
	try {
		await askCloud(await linked(), '/alarmas', { body: { action: 'stopped', id: cloudId } });
	} catch (error) {
		log.warn('avisos', 'La nube no se enteró de que se ha parado', { cloudId, error });
	}
}

// ——— The family's Telegram bot (#243), in the cloud ———

/** A timer ringing, to the family's group if it hears that; never failing what happened here. */
export async function tellGroup(text: string) {
	try {
		await askCloud(await linked(), '/telegram', {
			body: { action: 'tell', event: 'temporizadores', text }
		});
	} catch (error) {
		log.warn('telegram', 'No se pudo avisar al grupo', { error });
	}
}

/** «Di en el grupo que ya está la comida», by voice: the group's name; throws, said for a person. */
export async function sayInGroup(from: string, text: string) {
	return (
		await askCloud<{ group: string }>(await linked(), '/telegram', {
			body: { action: 'say', from, text }
		})
	).group;
}

/** How long the answer to «is the bot in a group?» is kept: asked with every voice order. */
const GROUP_CHECK_MS = 5 * 60_000;
let groupChecked: { at: number; group: boolean } | null = null;

/** Whether the family's bot is in a group to say things in (not connected, no). */
export async function botHasGroup() {
	if (groupChecked && Date.now() - groupChecked.at < GROUP_CHECK_MS) return groupChecked.group;
	let group = false;
	try {
		group = (await askCloud<{ group: boolean }>(await linked(), '/telegram')).group;
	} catch {
		// Without the cloud, no group.
	}
	groupChecked = { at: Date.now(), group };
	return group;
}

import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';
import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import { log } from '#lib/server/log.ts';
import { decrypt, encrypt } from '#lib/server/secret-box.ts';
import { localDay } from 'comun/agenda.ts';
import type { FridgeState } from 'comun/fridge.ts';

/**
 * The family's cloud (#253): the fridge, the recipe book, the expenses, the agenda, the alarms and
 * the voice's brain live there (its /api/casa), with its address and the key it gave the house
 * (Ajustes → Casa → «La nube»). The voice and the TV use them from here. What is
 * said goes in the name of who says it, by their email, when it is known (not a satellite).
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
	{
		userId = null,
		body,
		timeoutMs = 15_000
	}: { userId?: string | null; body?: unknown; timeoutMs?: number } = {}
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
			signal: AbortSignal.timeout(timeoutMs)
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

// ——— The agenda and the alarms (#200, #241) ———

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

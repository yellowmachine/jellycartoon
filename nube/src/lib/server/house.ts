import { eq } from 'drizzle-orm';
import { house } from './db/schema.ts';
import { withFamily } from './family.ts';
import { decrypt, encrypt } from './secret-box.ts';

export { houseUrl } from './house-url.ts';

/**
 * The family's house (jellycartoon, #253): its address from outside (MEDIA_HOST, through the
 * rathole tunnel) and the key it gave the cloud, to ask its APIs in the name of the person using
 * the cloud, by their email (the same in both apps).
 */

export interface HouseLink {
	url: string;
	/** Only how it starts, for Ajustes: the key itself never leaves the server. */
	keyStart: string;
	updatedAt: Date;
}

export async function houseLink(userId: string): Promise<HouseLink | null> {
	const [row] = await withFamily(userId, (tx) => tx.select().from(house));
	if (!row) return null;
	const key = decrypt(row.key);
	return { url: row.url, keyStart: key ? `${key.slice(0, 11)}…` : '¿?', updatedAt: row.updatedAt };
}

/** Its address and key, or a new key alone (an empty one keeps the one there was). */
export async function saveHouse(userId: string, url: string, key: string | null) {
	await withFamily(userId, async (tx, { familyId }) => {
		const [row] = await tx.select({ key: house.key }).from(house);
		const stored = key ? encrypt(key) : row?.key;
		if (!stored) throw new Error('Falta la clave');
		await tx
			.insert(house)
			.values({ familyId, url, key: stored })
			.onConflictDoUpdate({ target: house.familyId, set: { url, key: stored } });
	});
}

export async function forgetHouse(userId: string) {
	await withFamily(userId, (tx, { familyId }) =>
		tx.delete(house).where(eq(house.familyId, familyId))
	);
}

/** Why the house did not answer, said for people. */
const PROBLEMS: Record<number, string> = {
	401: 'La casa no acepta la clave: crea otra en Ajustes → Casa → «La nube» de jellycartoon',
	403: 'La casa no conoce tu email: tiene que ser el mismo que el de tu cuenta de casa',
	404: 'Esa dirección no tiene la API de vídeo: ¿es la de MEDIA_HOST, con jellycartoon 1.84 o más?'
};

/**
 * A request to the house's API, in this person's name. Throws with a sentence for people if it
 * does not answer as expected.
 */
export async function askHouse<T>(
	userId: string,
	email: string,
	path: string,
	init: RequestInit = {}
): Promise<T> {
	const [row] = await withFamily(userId, (tx) => tx.select().from(house));
	if (!row) throw new HouseProblem('Tu familia aún no ha conectado su casa');
	const key = decrypt(row.key);
	if (!key) throw new HouseProblem('La clave guardada no se puede leer: vuelve a ponerla');
	let response: Response;
	try {
		response = await fetch(`${row.url}/api/v1${path}`, {
			...init,
			headers: { 'x-api-key': key, 'x-persona': email, 'content-type': 'application/json' },
			signal: AbortSignal.timeout(10_000)
		});
	} catch {
		throw new HouseProblem('La casa no contesta: ¿está encendida, con el túnel conectado?');
	}
	if (!response.ok)
		throw new HouseProblem(PROBLEMS[response.status] ?? `La casa contestó ${response.status}`);
	return response.json() as Promise<T>;
}

export class HouseProblem extends Error {}

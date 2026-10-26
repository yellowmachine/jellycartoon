import { auth } from '#lib/server/auth.ts';

/**
 * The voice satellites (#223): a device in a room that hears «hola casita» and sends the order,
 * with a key of its own (better-auth's api-key plugin, auth.ts). The administrator makes it in
 * Ajustes, and it is theirs; but what it is told goes as said by «la casa», as anyone in the room
 * may speak (voice/command.ts).
 */

/** Where the satellite sends its key, as the plugin reads it. */
const HEADER = 'x-api-key';

/** The only paths a key opens: what it heard, the order, and the living room lowered meanwhile. */
export const SATELLITE_PATHS = ['/api/voice/transcribe', '/api/voice/command', '/api/salon/bajar'];

export interface Satellite {
	id: string;
	name: string;
	/** Who made its key: what it writes (the agenda, a note) goes in their name. */
	ownerId: string;
}

/** Marked so in its key: the plugin's keys may be for something else one day. */
const isSatellite = (metadata: unknown) =>
	Boolean(metadata && typeof metadata === 'object' && 'satellite' in metadata);

/** The satellite whose key came with the request; null without one, or with a wrong one. */
export async function satelliteOf(request: Request): Promise<Satellite | null> {
	const key = request.headers.get(HEADER);
	if (!key) return null;
	const { valid, key: found } = await auth.api.verifyApiKey({ body: { key } });
	if (!valid || !found || !isSatellite(found.metadata)) return null;
	return { id: found.id, name: found.name ?? 'Satélite', ownerId: found.referenceId };
}

/** This adult's satellites, for Ajustes: never their keys, only how they start. */
export async function listSatellites(headers: Headers) {
	const { apiKeys } = await auth.api.listApiKeys({ headers });
	return apiKeys
		.filter((k) => isSatellite(k.metadata))
		.map((k) => ({
			id: k.id,
			name: k.name ?? 'Satélite',
			start: k.start,
			createdAt: k.createdAt,
			lastRequest: k.lastRequest
		}));
}

/** A new satellite: its key, shown once. */
export async function createSatellite(name: string, headers: Headers) {
	const created = await auth.api.createApiKey({
		body: { name, metadata: { satellite: true } },
		headers
	});
	return created.key;
}

export async function deleteSatellite(id: string, headers: Headers) {
	await auth.api.deleteApiKey({ body: { keyId: id }, headers });
}

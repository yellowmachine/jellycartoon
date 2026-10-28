import { randomBytes } from 'node:crypto';
import { relayConfig } from '#lib/server/app-settings.ts';
import { log } from '#lib/server/log.ts';

/**
 * Sharing a trip (#81): the road mode's positions, on to the trips relay (relay/, on a VPS) for
 * whoever has its link. One per user at a time, in memory: a link is a random token, made when it
 * starts and dead when it stops. The tablet never talks to the relay: its key stays here.
 */

export interface SharePosition {
	lon: number;
	lat: number;
	t: number;
	speed: number | null;
	heading: number | null;
}

interface Share {
	token: string;
	url: string;
	name: string;
	destination: string | null;
	arrivesAt: number | null;
	position: SharePosition | null;
	/** When the relay was last told, and when the tablet last said anything. */
	sentAt: number;
	heardAt: number;
	/** Something new not sent yet: it goes at most every SEND_EVERY_MS. */
	pending: boolean;
}

/** At most this often to the relay: whoever watches does not need more. */
const SEND_EVERY_MS = 10_000;
/** The tablet silent this long (closed, asleep, no signal): it stops. The relay has its own, 2 h. */
const SILENT_MS = 15 * 60_000;

const shares = new Map<string, Share>();

async function relay(method: 'PUT' | 'DELETE', token: string, body?: object) {
	const { url, key } = await relayConfig();
	if (!url || !key)
		throw new Error('Falta el repetidor de viajes: su dirección y su clave, en Ajustes.');
	const res = await fetch(`${url}/api/viajes/${token}`, {
		method,
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new Error(`El repetidor de viajes respondió ${res.status}`);
}

async function send(share: Share) {
	share.pending = false;
	share.sentAt = Date.now();
	const { name, destination, arrivesAt, position } = share;
	await relay('PUT', share.token, { name, destination, arrivesAt, position }).catch((error) =>
		log.warn('viajes', 'No se pudo mandar la posición al repetidor', { error })
	);
}

/** This user's trip being shared, if it is: its link. */
export function sharing(userId: string) {
	return shares.get(userId)?.url ?? null;
}

/** Starts sharing (or goes on with the one there is): its link, to send. */
export async function startSharing(userId: string, name: string) {
	const before = shares.get(userId);
	if (before) return before.url;
	const { url } = await relayConfig();
	const token = randomBytes(16).toString('base64url');
	const share: Share = {
		token,
		url: `${url}/s/${token}`,
		name,
		destination: null,
		arrivesAt: null,
		position: null,
		sentAt: 0,
		heardAt: Date.now(),
		pending: false
	};
	await relay('PUT', token, { name });
	shares.set(userId, share);
	log.info('viajes', 'Viaje compartido', { userId });
	return share.url;
}

/** The tablet's news: sent on now, or with the next one (SEND_EVERY_MS). */
export async function updateSharing(
	userId: string,
	news: { position: SharePosition | null; destination: string | null; arrivesAt: number | null }
) {
	const share = shares.get(userId);
	if (!share) return false;
	share.heardAt = Date.now();
	if (news.position) share.position = news.position;
	share.destination = news.destination;
	share.arrivesAt = news.arrivesAt;
	share.pending = true;
	if (Date.now() - share.sentAt >= SEND_EVERY_MS) await send(share);
	return true;
}

/** Stopped, arrived or gone: its link no longer shows where. */
export async function stopSharing(userId: string) {
	const share = shares.get(userId);
	if (!share) return;
	shares.delete(userId);
	await relay('DELETE', share.token).catch((error) =>
		log.warn('viajes', 'No se pudo dejar de compartir en el repetidor', { error })
	);
	log.info('viajes', 'Viaje ya no compartido', { userId });
}

// What waited goes; the silent ones stop.
setInterval(() => {
	for (const [userId, share] of shares) {
		if (Date.now() - share.heardAt > SILENT_MS) void stopSharing(userId);
		else if (share.pending && Date.now() - share.sentAt >= SEND_EVERY_MS) void send(share);
	}
}, SEND_EVERY_MS).unref?.();

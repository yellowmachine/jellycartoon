import { randomBytes } from 'node:crypto';
import { ORIGIN } from '$app/env/private';
import { TripStore, type Position } from './share-store.ts';

/**
 * Sharing a trip (#81): the road mode's positions, for whoever has its link (/s/<token>, public, no
 * account). One per person at a time, in memory only: a link is a random token, made when it starts
 * and dead when it stops. Since #253 the cloud shows it itself: jellycartoon needed a relay on a VPS
 * (relay/) because it was not reachable from outside.
 */

export type SharePosition = Position;

interface Share {
	token: string;
	/** When the tablet last said anything. */
	heardAt: number;
}

/** The tablet silent this long (closed, asleep, no signal): it stops. The store has its own, 2 h. */
const SILENT_MS = 15 * 60_000;

export const trips = new TripStore();
const shares = new Map<string, Share>();

const linkOf = (token: string) => `${ORIGIN}/s/${token}`;

/** This person's trip being shared, if it is: its link. */
export function sharing(userId: string) {
	const share = shares.get(userId);
	return share ? linkOf(share.token) : null;
}

/** Starts sharing (or goes on with the one there is): its link, to send. */
export function startSharing(userId: string, name: string) {
	const before = shares.get(userId);
	if (before) return linkOf(before.token);
	const token = randomBytes(16).toString('base64url');
	trips.publish(token, { name });
	shares.set(userId, { token, heardAt: Date.now() });
	console.info('[viajes] Viaje compartido', { userId });
	return linkOf(token);
}

/** The tablet's news, to whoever watches. */
export function updateSharing(
	userId: string,
	news: { position: SharePosition | null; destination: string | null; arrivesAt: number | null }
) {
	const share = shares.get(userId);
	if (!share) return false;
	share.heardAt = Date.now();
	trips.publish(share.token, {
		destination: news.destination,
		arrivesAt: news.arrivesAt,
		...(news.position ? { position: news.position } : {})
	});
	return true;
}

/** Stopped, arrived or gone: its link no longer shows where. */
export function stopSharing(userId: string) {
	const share = shares.get(userId);
	if (!share) return;
	shares.delete(userId);
	trips.end(share.token);
	console.info('[viajes] Viaje ya no compartido', { userId });
}

// The silent ones stop; the store forgets the old ones.
setInterval(() => {
	for (const [userId, share] of shares)
		if (Date.now() - share.heardAt > SILENT_MS) stopSharing(userId);
	trips.sweep();
}, 60_000).unref?.();

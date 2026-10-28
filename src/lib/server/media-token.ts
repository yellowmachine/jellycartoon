import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The signed links of the video API (#253): an episode's HLS for one person, in one quality, for
 * a few hours. In the path, so that the playlists' relative links (segments, subtitles) keep it
 * and the browser needs no cookie nor key; the key stays with whoever asked for it (the cloud).
 * Apart, without the server's modules, to be tested.
 */

export type MediaQuality = 'light' | 'original';

export interface MediaGrant {
	userId: string;
	episodeId: number;
	quality: MediaQuality;
	/** When it stops working, in ms since the epoch. */
	expires: number;
}

/** Long enough for a film-length pause; a new one is asked for on each «ver». */
export const GRANT_HOURS = 12;

const signature = (key: Buffer, payload: string) =>
	createHmac('sha256', key).update(payload).digest('base64url');

/** `payload.signature`, both base64url: safe in a path. */
export function signGrant(key: Buffer, grant: MediaGrant) {
	const payload = Buffer.from(
		JSON.stringify([grant.userId, grant.episodeId, grant.quality, grant.expires])
	).toString('base64url');
	return `${payload}.${signature(key, payload)}`;
}

/** The grant, or null if it was not signed with this key, is malformed or has expired. */
export function readGrant(key: Buffer, token: string, now = Date.now()): MediaGrant | null {
	const [payload, sig, extra] = token.split('.');
	if (!payload || !sig || extra !== undefined) return null;
	const expected = Buffer.from(signature(key, payload));
	const given = Buffer.from(sig);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
	try {
		const [userId, episodeId, quality, expires] = JSON.parse(
			Buffer.from(payload, 'base64url').toString()
		);
		if (
			typeof userId !== 'string' ||
			!Number.isInteger(episodeId) ||
			(quality !== 'light' && quality !== 'original') ||
			typeof expires !== 'number' ||
			expires < now
		)
			return null;
		return { userId, episodeId, quality, expires };
	} catch {
		return null;
	}
}

/**
 * A music pass (#253): any track and cover of the house's music, for one person, for a few hours.
 * The music is the whole house's, so it is not one track at a time: the cloud asks for a pass and
 * its page makes the links of what it plays from it.
 */
export interface MusicPass {
	userId: string;
	/** When it stops working, in ms since the epoch. */
	expires: number;
}

export function signMusicPass(key: Buffer, pass: MusicPass) {
	const payload = Buffer.from(JSON.stringify(['music', pass.userId, pass.expires])).toString(
		'base64url'
	);
	return `${payload}.${signature(key, payload)}`;
}

/** The pass, or null if it was not signed with this key, is not a pass or has expired. */
export function readMusicPass(key: Buffer, token: string, now = Date.now()): MusicPass | null {
	const [payload, sig, extra] = token.split('.');
	if (!payload || !sig || extra !== undefined) return null;
	const expected = Buffer.from(signature(key, payload));
	const given = Buffer.from(sig);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
	try {
		const [kind, userId, expires] = JSON.parse(Buffer.from(payload, 'base64url').toString());
		if (kind !== 'music' || typeof userId !== 'string' || typeof expires !== 'number') return null;
		return expires < now ? null : { userId, expires };
	} catch {
		return null;
	}
}

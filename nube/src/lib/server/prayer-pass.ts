import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Oración's pass (#339, por Snapcast): the family's recordings, for a few hours, without a session,
 * for the house's mpv to open them (it has no cookie). In the path, as the house's music pass, the
 * other way round: signed here, read here. Apart, without the server's modules, to be tested.
 */

export interface PrayerPass {
	familyId: string;
	/** When it stops working, in ms since the epoch. */
	expires: number;
}

/** Long enough for a rosary paused a while; a new one each time a list is sent to the house. */
export const PASS_HOURS = 12;

const signature = (key: Buffer, payload: string) =>
	createHmac('sha256', key).update(payload).digest('base64url');

/** `payload.signature`, both base64url: safe in a path. */
export function signPrayerPass(key: Buffer, pass: PrayerPass) {
	const payload = Buffer.from(JSON.stringify(['oracion', pass.familyId, pass.expires])).toString(
		'base64url'
	);
	return `${payload}.${signature(key, payload)}`;
}

/** The pass, or null if it was not signed with this key, is not one or has expired. */
export function readPrayerPass(key: Buffer, token: string, now = Date.now()): PrayerPass | null {
	const [payload, sig, extra] = token.split('.');
	if (!payload || !sig || extra !== undefined) return null;
	const expected = Buffer.from(signature(key, payload));
	const given = Buffer.from(sig);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
	try {
		const [kind, familyId, expires] = JSON.parse(Buffer.from(payload, 'base64url').toString());
		if (kind !== 'oracion' || typeof familyId !== 'string' || typeof expires !== 'number')
			return null;
		return expires < now ? null : { familyId, expires };
	} catch {
		return null;
	}
}

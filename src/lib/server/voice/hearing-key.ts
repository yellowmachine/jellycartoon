import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * What a satellite of Seilide's goes to the house's Whisper with, by itself (#430): the audio to
 * write down is all it opens, not the house. `id.signature`, signed here and given through the
 * cloud (/api/v1/voz/oir/clave), so nothing is stored. It does not expire, as the satellite has it
 * for as long as it runs. Apart, without the server's modules, to be tested.
 */

const signature = (secret: string, satellite: string) =>
	createHmac('sha256', secret).update(`voz-oir:${satellite}`).digest('base64url');

export const hearingKey = (secret: string, satellite: string) =>
	`${satellite}.${signature(secret, satellite)}`;

export function validHearingKey(secret: string, key: string | null) {
	if (!key) return false;
	const dot = key.lastIndexOf('.');
	if (dot <= 0) return false;
	const expected = Buffer.from(signature(secret, key.slice(0, dot)));
	const given = Buffer.from(key.slice(dot + 1));
	return expected.length === given.length && timingSafeEqual(expected, given);
}

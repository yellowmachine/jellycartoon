import { setMusicUrls } from 'comun/music.ts';
import type { MusicPass } from '#lib/server/music.ts';

/**
 * The house's songs, covers and Modo DJ's words in this browser (#253): straight from the house,
 * by a signed pass (its /api/v1/musica/<pass>/…), for Música and the road mode. A new one every
 * few hours: it lasts 12.
 */

const RENEW_MS = 6 * 3_600_000;

let renewing: ReturnType<typeof setInterval> | undefined;

export function usePass(pass: MusicPass) {
	setMusicUrls({
		track: (id) => `${pass.base}/pistas/${id}`,
		cover: (albumId) => `${pass.base}/portadas/${albumId}`,
		clip: (id) => `${pass.base}/locutor/${id}`
	});
	renewing ??= setInterval(() => void askPass(), RENEW_MS);
}

/** A pass asked for now, and used; why not, if the house does not give one. */
export async function askPass(fetcher: typeof fetch = fetch): Promise<string | null> {
	const res = await fetcher('/api/musica/pase', { method: 'POST' }).catch(() => null);
	if (res?.ok) {
		usePass(await res.json());
		return null;
	}
	return (await res?.json().catch(() => null))?.message ?? 'La casa no contesta';
}

import { setMusicUrls } from 'comun/music.ts';
import { setThumbBase } from 'comun/thumb.svelte.ts';
import { offlineMusic } from '#lib/offline-music.svelte.ts';
import type { MusicPass } from '#lib/server/music.ts';

/**
 * The house's songs, covers and Modo DJ's words, and its episodes' thumbnails and series'
 * backgrounds, in this browser (#253): straight from the house, by a signed pass (its
 * /api/v1/musica/<pass>/… and /api/v1/imagenes/<pass>/…), for Música, Series and the road mode. A
 * new one every few hours: it lasts 12.
 */

const RENEW_MS = 6 * 3_600_000;

let renewing: ReturnType<typeof setInterval> | undefined;
/** Where the house's images are, by the pass in use. */
let images = '';

/** The image behind the top of a series' page. */
export const seriesBackdropUrl = (seriesId: number) => `${images}/fondos/${seriesId}`;

export function usePass(pass: MusicPass) {
	setMusicUrls({
		// Kept on this device, such as the car's tablet (#350): from its disk, coverage or not.
		track: (id) => offlineMusic.urlOf(id) ?? `${pass.base}/pistas/${id}`,
		cover: (albumId) => offlineMusic.coverOf(albumId) ?? `${pass.base}/portadas/${albumId}`,
		clip: (id) => `${pass.base}/locutor/${id}`,
		held: offlineMusic.has
	});
	images = pass.images;
	setThumbBase(`${pass.images}/miniaturas`);
	renewing ??= setInterval(() => void askPass(), RENEW_MS);
}

/**
 * Without the house (no pass): only what this device keeps (#350), from its disk. Its songs only:
 * the road mode puts on no other.
 */
export function useKept() {
	setMusicUrls({
		track: (id) => offlineMusic.urlOf(id) ?? '',
		cover: (albumId) => offlineMusic.coverOf(albumId) ?? '',
		held: offlineMusic.has
	});
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

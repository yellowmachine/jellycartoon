import type { Lyrics } from './lyrics.ts';
import { lyricsUrl } from './music.ts';

/**
 * Songs' lyrics in this browser, asked once each: what the bar's «Letra» and /tv show. A failure
 * is not kept, so it is asked again next time.
 */
const asked = new Map<number, Promise<Lyrics | null>>();

export function loadLyrics(trackId: number): Promise<Lyrics | null> {
	const url = lyricsUrl(trackId);
	if (!url) return Promise.resolve(null);
	let found = asked.get(trackId);
	if (!found) {
		found = fetch(url)
			.then((res) => (res.ok ? (res.json() as Promise<Lyrics | null>) : Promise.reject()))
			.catch(() => {
				asked.delete(trackId);
				return null;
			});
		asked.set(trackId, found);
	}
	return found;
}

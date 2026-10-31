import type { MusicTrack, SnapcastRemote, SnapcastRemoteItem } from 'comun/music.ts';

/**
 * Seilide's on the house's Snapcast (#339, Oración): its own addresses, only from Seilide's own
 * (the one connected in Ajustes → Casa), as mpv opens whatever it is given; and the pauses, made
 * by mpv itself (libavfilter's silence), without asking for them. Apart, to be tested.
 */

export const MAX_REMOTE_ITEMS = 1000;
export const MAX_REMOTE_PAUSE = 30;

/** That many seconds of silence, as mpv opens it (`av://lavfi:`, its libavfilter input). */
export const silenceUrl = (sec: number) => `av://lavfi:anullsrc=r=48000:cl=mono:d=${sec}`;

const text = (value: unknown, most: number) =>
	typeof value === 'string' ? value.trim().slice(0, most) : '';

/** Only well-formed ones, and only addresses of `cloud` (Seilide's origin); null, not one. */
export function parseRemote(body: unknown, cloud: string): SnapcastRemote | null {
	if (!body || typeof body !== 'object') return null;
	const { artist, album, items } = body as Record<string, unknown>;
	if (!Array.isArray(items) || !items.length || items.length > MAX_REMOTE_ITEMS) return null;
	const origin = new URL(cloud).origin;
	const parsed: SnapcastRemoteItem[] = [];
	for (const item of items as Record<string, unknown>[]) {
		if (item && typeof item === 'object' && 'pauseSec' in item) {
			const sec = Math.round(Number(item.pauseSec));
			if (!Number.isFinite(sec) || sec < 1 || sec > MAX_REMOTE_PAUSE) return null;
			parsed.push({ pauseSec: sec });
			continue;
		}
		const src = typeof item?.src === 'string' ? item.src : '';
		let url: URL;
		try {
			url = new URL(src);
		} catch {
			return null;
		}
		if (url.origin !== origin) return null;
		const durationSec = Number(item.durationSec);
		parsed.push({
			title: text(item.title, 200) || 'Sin título',
			src: url.href,
			durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null
		});
	}
	return { artist: text(artist, 200) || 'Seilide', album: text(album, 200), items: parsed };
}

/** As the queue has them: tracks of no album, each with what mpv opens. */
export function remoteTracks(remote: SnapcastRemote) {
	return remote.items.map((item, i): { track: MusicTrack; path: string } => {
		const pause = 'pauseSec' in item;
		const path = pause ? silenceUrl(item.pauseSec) : item.src;
		return {
			track: {
				// Not the library's: negative, one each.
				id: -(i + 1),
				title: pause ? 'Pausa' : item.title,
				artist: remote.artist,
				album: remote.album,
				number: null,
				durationSec: pause ? item.pauseSec : item.durationSec,
				albumId: 0,
				hasCover: false,
				src: path
			},
			path
		};
	});
}

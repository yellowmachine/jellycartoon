/**
 * The house's music, as its API gives it (jellycartoon's /api/v1/musica, #253): what the road mode
 * shows and plays. Shared by the server and the page.
 */

export interface MusicTrack {
	id: number;
	title: string;
	artist: string;
	number: number | null;
	durationSec: number | null;
	albumId: number;
	album: string;
	hasCover: boolean;
}

export interface MusicAlbumSummary {
	id: number;
	title: string;
	artist: string;
	hasCover: boolean;
	tracks: number;
	durationSec: number;
}

export interface MusicPlaylistSummary {
	id: number;
	name: string;
	total: number;
	durationSec: number;
}

/** Where the house's tracks and covers are, for a while (a signed pass). */
export interface MusicPass {
	base: string;
	expires: string;
}

export const trackUrl = (pass: MusicPass, id: number) => `${pass.base}/pistas/${id}`;
export const coverUrl = (pass: MusicPass, albumId: number) => `${pass.base}/portadas/${albumId}`;

/** Accents and case do not matter: «heroes» finds «Héroes del Silencio». */
export const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** `1:02:03` or `4:05`. */
export function duration(seconds: number | null) {
	if (seconds === null || !Number.isFinite(seconds)) return '';
	const s = Math.round(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

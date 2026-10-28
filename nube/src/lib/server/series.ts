import type { AudioTrack, SubtitleTrack } from 'comun/languages.ts';
import type { SubtitleStyle } from 'comun/subtitle-style.ts';
import { askHouse } from './house.ts';

/**
 * The house's series (#253), for Series here: asked of its video API in the name of who watches.
 * The video itself, by signed links: the page opens it straight from the house, not through
 * here. Where each one is, kept at home: «Seguir viendo» is the same in both.
 */

interface Who {
	id: string;
	email: string;
}

export interface SeriesSummary {
	id: number;
	title: string;
	/** Ready to watch. */
	episodes: number;
	total: number;
	cover: number | null;
}

export interface SeriesEpisode {
	id: number;
	season: number;
	number: number;
	title: string;
	durationSec: number | null;
	light: boolean;
	audioTracks: AudioTrack[];
	positionSec: number;
	completed: boolean;
}

/** An episode as a card shows it (comun's EpisodeCard). */
export interface EpisodeCardData {
	id: number;
	seriesId: number;
	seriesTitle: string;
	season: number;
	number: number;
	title: string;
	durationSec: number | null;
	positionSec: number | null;
	completed: boolean | null;
}

export interface Watching {
	id: number;
	title: string;
	season: number;
	number: number;
	seriesId: number;
	seriesTitle: string;
	positionSec: number;
	durationSec: number | null;
}

/** What watching an episode needs: its links, its tracks, what follows and their choices. */
export interface WatchLinks {
	url: string;
	progressUrl: string;
	expires: string;
	quality: 'light' | 'original';
	positionSec: number;
	episode: {
		id: number;
		seriesId: number;
		season: number;
		number: number;
		title: string;
		durationSec: number | null;
		audioTracks: AudioTrack[];
		subtitles: SubtitleTrack[];
		seriesTitle: string;
		positionSec: number | null;
	};
	nextId: number | null;
	next: EpisodeCardData | null;
	suggestions: EpisodeCardData[];
	settings: {
		audioLang: string | null;
		subtitleLang: string | null;
		subtitleStyle: SubtitleStyle;
		autoNext: boolean;
	};
}

export const allSeries = async (who: Who) =>
	(await askHouse<{ series: SeriesSummary[] }>(who.id, who.email, '/series')).series;

export const continueWatching = async (who: Who) =>
	(await askHouse<{ episodes: Watching[] }>(who.id, who.email, '/seguir')).episodes;

/** Out of «Seguir viendo»; where it was left is kept. */
export const dismissWatching = (who: Who, episodeId: number) =>
	askHouse(who.id, who.email, `/seguir/${episodeId}`, { method: 'DELETE' });

export const seriesEpisodes = (who: Who, seriesId: number) =>
	askHouse<{ id: number; title: string; episodes: SeriesEpisode[] }>(
		who.id,
		who.email,
		`/series/${seriesId}`
	);

/** To watch it: from where it was left, or from `startSec`. */
export const watchEpisode = (who: Who, episodeId: number, startSec: number | null) =>
	askHouse<WatchLinks>(who.id, who.email, `/episodios/${episodeId}/ver`, {
		method: 'POST',
		body: JSON.stringify(startSec === null ? {} : { inicio: startSec })
	});

export const setWatched = (who: Who, episodeId: number, watched: boolean) =>
	askHouse(who.id, who.email, `/episodios/${episodeId}/visto`, {
		method: 'POST',
		body: JSON.stringify({ watched })
	});

/** Their audio and subtitles' languages and what follows, at home. */
export const savePlayerChoices = (
	who: Who,
	values: { audioLang?: string | null; subtitleLang?: string | null; autoNext?: boolean }
) => askHouse(who.id, who.email, '/ajustes', { method: 'PATCH', body: JSON.stringify(values) });

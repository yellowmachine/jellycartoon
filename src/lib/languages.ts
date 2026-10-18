const ALIASES: Record<string, string> = {
	es: 'spa',
	en: 'eng',
	fr: 'fre',
	fra: 'fre',
	de: 'ger',
	deu: 'ger',
	it: 'ita',
	pt: 'por',
	ja: 'jpn',
	ca: 'cat'
};

const LABELS: Record<string, string> = {
	spa: 'Español',
	eng: 'English',
	fre: 'Français',
	ger: 'Deutsch',
	ita: 'Italiano',
	por: 'Português',
	jpn: '日本語',
	cat: 'Català'
};

/** The languages with a name, to choose from in Ajustes. */
export const KNOWN_LANGUAGES = Object.keys(LABELS);

/**
 * The ISO 639-1 code (`en`) Whisper takes for a language, or `auto` for it to find out: for one
 * without a two-letter alias here, or untagged (`und`).
 */
export function whisperLanguage(code: string | null | undefined) {
	const lang = normalizeLang(code);
	return Object.keys(ALIASES).find((k) => k.length === 2 && ALIASES[k] === lang) ?? 'auto';
}

/** Normalizes `en`, `en-US`, `eng`… to an ISO 639-2 code (`eng`). */
export function normalizeLang(code: string | null | undefined) {
	const base = (code ?? '').toLowerCase().split(/[-_]/)[0];
	if (!base) return 'und';
	return ALIASES[base] ?? base;
}

/** Not languages, as TV channels tag their tracks (RTVE). */
export const BROADCAST_TRACKS: Record<string, string> = {
	qaa: 'Versión original',
	ads: 'Audiodescripción'
};

export function languageLabel(code: string | null | undefined) {
	const lang = normalizeLang(code);
	return LABELS[lang] ?? (lang === 'und' ? 'Desconocido' : lang);
}

export interface SubtitleTrack {
	lang: string;
	label: string;
	file: string;
}

export interface AudioTrack {
	lang: string;
	label: string;
	/** The file did not say (`und`): the language set for its series was assumed. */
	assumed?: boolean;
}

/**
 * The series' audio language (`series.audioLang`) for the tracks whose file did not say, and
 * those that had it assumed before; null takes them back to unknown. The others stay as they are.
 */
export function assumeLanguage(tracks: AudioTrack[], lang: string | null): AudioTrack[] {
	return tracks.map((t) => {
		if (t.lang !== 'und' && !t.assumed) return t;
		if (!lang) return { lang: 'und', label: languageLabel('und') };
		const code = normalizeLang(lang);
		return { lang: code, label: languageLabel(code), assumed: true };
	});
}

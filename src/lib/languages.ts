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

/** Normalizes `en`, `en-US`, `eng`… to an ISO 639-2 code (`eng`). */
export function normalizeLang(code: string | null | undefined) {
	const base = (code ?? '').toLowerCase().split(/[-_]/)[0];
	if (!base) return 'und';
	return ALIASES[base] ?? base;
}

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
}

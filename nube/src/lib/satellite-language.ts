/**
 * The languages a satellite is spoken to in, and the one it answers in (#647), chosen for each in
 * Ajustes → Satélites de voz. Spanish by default, as before.
 */

export const SATELLITE_LANGUAGES = ['es', 'en', 'fr'] as const;
export type SatelliteLanguage = (typeof SATELLITE_LANGUAGES)[number];

/** What it answers in: one of them, or «como le hablen» (`auto`). */
export type AnswerLanguage = SatelliteLanguage | 'auto';

/** As said in Ajustes, each in its own language. */
export const LANGUAGE_NAMES: Record<SatelliteLanguage, string> = {
	es: 'Español',
	en: 'English',
	fr: 'Français'
};

export const isSatelliteLanguage = (code: unknown): code is SatelliteLanguage =>
	SATELLITE_LANGUAGES.includes(code as SatelliteLanguage);

/** Those saved, known and in order; none, Spanish. */
export function heardLanguages(saved: unknown): SatelliteLanguage[] {
	const list = Array.isArray(saved) ? saved : [];
	const known = SATELLITE_LANGUAGES.filter((l) => list.includes(l));
	return known.length ? known : ['es'];
}

/**
 * What it answers in, among those it is spoken to in: with only one, that one («como le hablen»
 * is the same); a language it is not spoken to in, «como le hablen».
 */
export function answerLanguage(saved: unknown, heard: SatelliteLanguage[]): AnswerLanguage {
	if (heard.length === 1) return heard[0];
	return isSatelliteLanguage(saved) && heard.includes(saved) ? saved : 'auto';
}

/**
 * The language to hear in: the only one it is spoken to in, which hears best; with several,
 * none, for the speech to text to find out (a short order may come out in the wrong one).
 */
export const hearingLanguage = (heard: SatelliteLanguage[]): SatelliteLanguage | null =>
	heard.length === 1 ? heard[0] : null;

/**
 * For the AI's instructions, which are in Spanish: «… en español». Spanish says it as before, so
 * the phone's and the car's are the same text, cached as they were.
 */
export function saidIn(language: AnswerLanguage) {
	switch (language) {
		case 'es':
			return 'en español';
		case 'en':
			return 'en inglés (in English), aunque te hablen en otro idioma';
		case 'fr':
			return 'en francés (en français), aunque te hablen en otro idioma';
		case 'auto':
			return 'en el idioma en que te hablen (español, inglés o francés)';
	}
}

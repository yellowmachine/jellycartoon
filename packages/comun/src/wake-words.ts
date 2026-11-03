/**
 * The words that wake the voice (#144), to choose on each phone or tablet (Ajustes) and on each
 * satellite (`WAKE_WORD`), by their model's file name in static/wakeword. «Alexa» is openWakeWord's
 * own, trained by them with much more data than the community's «hola casita» (LEEME.md): tried as
 * the house's, with the Echo off (2026-10-27). «Okapi», ours (trained in ../wakeup, 2026-11-02), the
 * same in English and Spanish and without «Alexa»'s non-commercial licence: tried with our voices.
 * «Ocarina», ours too (2026-11-03, 100.000 examples): over «Okapi» in ../wakeup's comparison
 * with music, to be tried with our voices and with «cocina» said around.
 */
export const WAKE_WORDS = {
	hola_casita: 'hola casita',
	alexa: 'Alexa',
	okapi: 'Okapi',
	ocarina: 'Ocarina'
} as const;

export type WakeWordModel = keyof typeof WAKE_WORDS;

export const DEFAULT_WAKE_WORD: WakeWordModel = 'hola_casita';

export const isWakeWord = (value: unknown): value is WakeWordModel =>
	typeof value === 'string' && Object.hasOwn(WAKE_WORDS, value);

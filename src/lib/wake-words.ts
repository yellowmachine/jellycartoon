/**
 * The words that wake the voice (#144), to choose on each phone or tablet (Ajustes) and on each
 * satellite (`WAKE_WORD`), by their model's file name in static/wakeword. «Alexa» is openWakeWord's
 * own, trained by them with much more data than the community's «hola casita» (LEEME.md): tried as
 * the house's, with the Echo off (2026-10-27).
 */
export const WAKE_WORDS = { hola_casita: 'hola casita', alexa: 'Alexa' } as const;

export type WakeWordModel = keyof typeof WAKE_WORDS;

export const DEFAULT_WAKE_WORD: WakeWordModel = 'hola_casita';

export const isWakeWord = (value: unknown): value is WakeWordModel =>
	typeof value === 'string' && Object.hasOwn(WAKE_WORDS, value);

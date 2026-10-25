/**
 * The takes of the wake word (#144, phase 3), for the page and the server: what kinds there are,
 * whose folder each goes in, and what a take is.
 */

/**
 * The words themselves, phrases like them (what they must not go off with), and what sounds where
 * they listen (music from the tablet itself), for the model to learn to hear the word over it.
 */
export const KINDS = ['jelly_cartoon', 'candy_candy', 'parecidas', 'fondo'] as const;
export type Kind = (typeof KINDS)[number];

const SAMPLE_RATE = 16_000;
/** A take is ~2.5 s: 80 KB. More than this is not one. */
export const MAX_SAMPLE_BYTES = 256 * 1024;
/** A take of «fondo» is 30 s, as the training's background clips: 960 KB. */
export const MAX_BACKGROUND_BYTES = 1024 * 1024;

export const maxBytes = (kind: Kind) =>
	kind === 'fondo' ? MAX_BACKGROUND_BYTES : MAX_SAMPLE_BYTES;

/** «Lucía (6)» → `lucia_6`: what goes in a folder's name. */
export function speakerSlug(name: string) {
	return name
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '')
		.slice(0, 40);
}

/** RIFF/WAVE, PCM, 1 channel, 16 kHz, 16 bits; and the data after the 44 bytes of header. */
export function isSampleWav(bytes: Uint8Array, max = MAX_SAMPLE_BYTES) {
	if (bytes.length <= 44 || bytes.length > max) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
	return (
		text(0) === 'RIFF' &&
		text(8) === 'WAVE' &&
		text(12) === 'fmt ' &&
		view.getUint16(20, true) === 1 &&
		view.getUint16(22, true) === 1 &&
		view.getUint32(24, true) === SAMPLE_RATE &&
		view.getUint16(34, true) === 16 &&
		text(36) === 'data' &&
		view.getUint32(40, true) === bytes.length - 44
	);
}

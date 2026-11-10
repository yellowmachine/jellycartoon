/** Phone numbers for the SIM's calls (#330, sim-phone.svelte.ts): written, read and dialled. */

/** Digits, and a leading «+»: what a `tel:` link and the phone app take. */
export function cleanNumber(number: string): string {
	const trimmed = number.trim();
	const digits = trimmed.replace(/\D/g, '');
	return trimmed.startsWith('+') || trimmed.startsWith('00')
		? `+${digits.replace(/^00/, '')}`
		: digits;
}

/** A number one can call: at least 3 digits (112, 016), at most 15 (the longest there are). */
export function isCallable(number: string): boolean {
	const digits = cleanNumber(number).replace('+', '');
	return digits.length >= 3 && digits.length <= 15;
}

export const telHref = (number: string) => `tel:${cleanNumber(number)}`;

/** A Spanish number in threes, to read it on the screen: «968 123 456». */
export function numberText(number: string): string {
	const n = cleanNumber(number);
	if (/^\d{9}$/.test(n)) return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
	return n;
}

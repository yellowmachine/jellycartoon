/**
 * The same order heard by two devices of a family at once: with one word for all, a tablet and a
 * satellite in a room both wake, and each sends what it heard. The first to arrive does it; the
 * other stays quiet (`elsewhere` in VoiceReply), so a note or a timer is not there twice.
 *
 * In memory, as there is one Seilide. Each device transcribes on its own, so two transcripts may
 * differ a little; with different numbers they are different orders («10 minutos», «15 minutos»).
 */

/** From the first device's order reaching here to the other's: they end and transcribe at their pace. */
export const TWIN_MS = 3000;
/** How alike two transcripts are (1, the same) to be one order. */
const ALIKE = 0.85;

interface Heard {
	source: string;
	text: string;
	at: number;
}

const recent = new Map<string, Heard[]>();

const clean = (text: string) =>
	text
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();

const numbers = (text: string) => text.match(/\d+/g)?.join(' ') ?? '';

function distance(a: string, b: string) {
	let row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++)
			next[j] = Math.min(
				row[j]! + 1,
				next[j - 1]! + 1,
				row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
		row = next;
	}
	return row[b.length]!;
}

function sameOrder(a: string, b: string) {
	if (a === b) return true;
	if (numbers(a) !== numbers(b)) return false;
	return 1 - distance(a, b) / Math.max(a.length, b.length) >= ALIKE;
}

/**
 * Whether another device of the family has just sent this order; if not, it is kept for the next.
 * The same device saying it twice is two orders. `source`: which device (a satellite, a session).
 */
export function heardElsewhere(
	familyId: string,
	source: string,
	text: string,
	now = Date.now()
): boolean {
	const said = clean(text);
	const fresh = (recent.get(familyId) ?? []).filter((h) => now - h.at < TWIN_MS);
	const twin = fresh.some((h) => h.source !== source && sameOrder(h.text, said));
	if (!twin) fresh.push({ source, text: said, at: now });
	if (fresh.length) recent.set(familyId, fresh);
	else recent.delete(familyId);
	return twin;
}

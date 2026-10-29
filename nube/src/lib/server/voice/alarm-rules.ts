/**
 * When to tell the family's administrators that the voice is failing (alarm.ts): the rules alone,
 * with the clock given, to test them. Two failures in a row, not one (a moment's hiccup); and the
 * fallback model answering in its place, which works but is not what they chose. Each at most once
 * in its while, so that a bad day is one notice, not twenty.
 */
export const FAILURES_TO_TELL = 2;
export const FAILING_EVERY_MS = 6 * 60 * 60_000;
export const FALLBACK_EVERY_MS = 24 * 60 * 60_000;

export type VoiceNotice = { kind: 'failing' | 'fallback'; detail: string };

export function voiceAlarm(now: () => number = Date.now) {
	const families = new Map<
		string,
		{ failures: number; toldFailing: number; toldFallback: number }
	>();
	const of = (familyId: string) => {
		let f = families.get(familyId);
		if (!f)
			families.set(
				familyId,
				(f = { failures: 0, toldFailing: -Infinity, toldFallback: -Infinity })
			);
		return f;
	};
	return {
		/** An order answered: the failures in a row start again. */
		ok(familyId: string) {
			of(familyId).failures = 0;
		},
		/** An order the voice could not answer; what to tell, if anything. */
		failed(familyId: string, detail: string): VoiceNotice | null {
			const f = of(familyId);
			f.failures++;
			if (f.failures < FAILURES_TO_TELL || now() - f.toldFailing < FAILING_EVERY_MS) return null;
			f.toldFailing = now();
			return { kind: 'failing', detail };
		},
		/** Answered by the fallback model; what to tell, if anything. */
		fellBack(familyId: string, detail: string): VoiceNotice | null {
			const f = of(familyId);
			f.failures = 0;
			if (now() - f.toldFallback < FALLBACK_EVERY_MS) return null;
			f.toldFallback = now();
			return { kind: 'fallback', detail };
		}
	};
}

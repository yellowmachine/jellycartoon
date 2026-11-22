import type { Kitchen } from '#lib/server/fridge.ts';
import type { PlaceHappened, PlugHappened } from '#lib/server/rule-check.ts';

/**
 * What rules may wait for (#331), told after it is saved: a post-it or something on the list,
 * something remembered (or deduced by a rule: `chain`, the rules it came through), something
 * said to the voice, a purchase saved in Gastos (#451: its shop, and `bought`, what it has), or a
 * plug's cycle that starts or ends (#528: its name, and `plug`, which and when), or a person
 * arriving at or leaving a place (#593: its name, and `place`, whose and which). Never in the
 * way: rules.ts listens here once loaded (the clock loads it at start, scheduler.ts), so the
 * fridge and the memory need not load it (it needs them); and what fails is only logged.
 */
export type EventKind = 'nevera' | 'recuerdo' | 'dicho' | 'compra' | 'enchufe' | 'lugar';
type Kind = EventKind;

/** A purchase (#451): which expense (told once for it), and each of its lines, with its tag. */
export interface Bought {
	expenseId: number;
	items: string[];
}
type Listener = (
	k: Kitchen,
	kind: Kind,
	text: string,
	ownerId: string | null,
	chain: number[],
	bought?: Bought,
	plug?: PlugHappened,
	place?: PlaceHappened
) => Promise<void>;

let listener: Listener | null = null;

export function listenRules(l: Listener) {
	listener = l;
}

export function ruleEvent(
	k: Kitchen,
	kind: Kind,
	text: string,
	ownerId: string | null = null,
	chain: number[] = [],
	bought?: Bought,
	plug?: PlugHappened,
	place?: PlaceHappened
) {
	void listener?.(k, kind, text, ownerId, chain, bought, plug, place).catch((error) =>
		console.warn('[reglas] No se pudieron mirar', { kind, error: String(error) })
	);
}

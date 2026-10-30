import type { Kitchen } from '#lib/server/fridge.ts';

/**
 * What rules may wait for (#331), told after it is saved: a post-it or something on the list, or
 * something remembered. Never in the way: rules.ts listens here once loaded (the clock loads it at
 * start, scheduler.ts), so the fridge and the memory need not load it (it needs them); and what
 * fails is only logged.
 */
type Kind = 'nevera' | 'recuerdo';
type Listener = (k: Kitchen, kind: Kind, text: string, ownerId: string | null) => Promise<void>;

let listener: Listener | null = null;

export function listenRules(l: Listener) {
	listener = l;
}

export function ruleEvent(k: Kitchen, kind: Kind, text: string, ownerId: string | null = null) {
	void listener?.(k, kind, text, ownerId).catch((error) =>
		console.warn('[reglas] No se pudieron mirar', { kind, error: String(error) })
	);
}

import { keyBalance, watchCost } from '#lib/server/openrouter.ts';
import type { AiSpend } from '#lib/ai-spend.ts';

/**
 * The month's AI spending under the header (#193), live: OpenRouter's own figure (the key's
 * `usage_monthly`, and the account's credit), asked every few minutes while some page shows it;
 * in between, each request's cost added as it comes back. Its first phase: the house's total.
 */

/** OpenRouter asked again after this long, while some page shows it. */
const REFRESH_MS = 10 * 60_000;

let spend: AiSpend | null = null;
let askedAt = 0;
let asking: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<(spend: AiSpend | null) => void>();

function tell() {
	for (const listener of listeners) listener(spend);
}

function refresh() {
	asking ??= keyBalance()
		.then((balance) => {
			askedAt = Date.now();
			spend = balance
				? { month: balance.spent.month, left: balance.credits?.left ?? balance.left }
				: null;
			tell();
		})
		.finally(() => (asking = null));
	return asking;
}

// Each request's cost, at once: what OpenRouter says next replaces the sum.
watchCost((cost) => {
	if (!spend) return;
	spend = { month: spend.month + cost, left: spend.left === null ? null : spend.left - cost };
	tell();
});

/** A page showing the line: told now and on every change; OpenRouter asked only while any does. */
export function watchAiSpend(listener: (spend: AiSpend | null) => void) {
	listeners.add(listener);
	if (Date.now() - askedAt > 60_000) void refresh();
	else listener(spend);
	timer ??= setInterval(() => void refresh(), REFRESH_MS);
	return () => {
		listeners.delete(listener);
		if (!listeners.size) {
			clearInterval(timer);
			timer = undefined;
		}
	};
}

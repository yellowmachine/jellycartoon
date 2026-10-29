/**
 * The AI's spending (#193), in the line under the header, at home and in the cloud: OpenRouter's
 * own figures for the key, and the last requests' costs. In dollars.
 */
export interface AiSpend {
	/** OpenRouter's figures for the key: all its life, this month and this week (in UTC). */
	total: number;
	month: number;
	week: number;
	/** The last requests, the newest first. */
	recent: AiCost[];
}

/** What one request to the AI cost. */
export interface AiCost {
	/** What it was for, as the Registro says it: e.g. «Sinopsis de «Tiburón»». */
	label: string;
	cost: number;
	/** ISO. */
	at: string;
}

/** The last requests the line shows. */
export const RECENT_COSTS = 3;

/** «3,42 $». */
export const dollars = (amount: number) =>
	`${amount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

/** A request's cost, a fraction of a cent too: «0,0213 $». */
export const cost = (amount: number) =>
	`${amount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;

/** OpenRouter asked again after this long, while some page shows the line. */
const REFRESH_MS = 10 * 60_000;

/**
 * One key's spending, live, for the pages that show it: OpenRouter's figures (`read`) asked every
 * few minutes while any does; in between, each request's cost (`add`) summed to them as it comes
 * back. `recent` gives the last costs from before it started (home's Registro); `add` keeps them after.
 */
export function spendTracker(source: {
	read: () => Promise<{ total: number; month: number; week: number } | null>;
	recent?: () => Promise<AiCost[]>;
}) {
	let spend: AiSpend | null = null;
	let recent: AiCost[] = [];
	// Those from before, behind any added since.
	const before = (source.recent?.() ?? Promise.resolve([]))
		.catch(() => [])
		.then((last) => void (recent = [...recent, ...last].slice(0, RECENT_COSTS)));
	let askedAt = 0;
	let asking: Promise<void> | null = null;
	let timer: ReturnType<typeof setInterval> | undefined;
	const listeners = new Set<(spend: AiSpend | null) => void>();

	const tell = () => {
		for (const listener of listeners) listener(spend);
	};

	const refresh = () =>
		(asking ??= Promise.all([source.read(), before])
			.then(([figures]) => {
				askedAt = Date.now();
				spend = figures && { ...figures, recent };
				tell();
			})
			.finally(() => (asking = null)));

	return {
		/** A request's cost, at once: what OpenRouter says next replaces the sums. */
		add(label: string, dollars: number, at = new Date()) {
			recent = [{ label, cost: dollars, at: at.toISOString() }, ...recent].slice(0, RECENT_COSTS);
			if (!spend) return;
			spend = {
				total: spend.total + dollars,
				month: spend.month + dollars,
				week: spend.week + dollars,
				recent
			};
			tell();
		},
		/** A page showing the line: told now and on every change. */
		watch(listener: (spend: AiSpend | null) => void) {
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
	};
}

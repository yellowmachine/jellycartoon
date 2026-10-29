import { spendTracker, type AiSpend } from 'comun/ai-spend.ts';
import { noteAiCost } from '#lib/server/expenses/ai-costs.ts';
import { familyOfKey } from '#lib/server/family-settings.ts';
import { watchCost } from '#lib/server/openrouter.ts';

/**
 * The AI's spending under the header (#193), as at home, for each family's key: OpenRouter's own
 * figures (https://openrouter.ai/docs/api/reference/limits, `GET /api/v1/key`) and the last
 * requests' costs, kept only while the server runs.
 */

/** Each key's, while the server runs: the key itself never leaves it. */
const trackers = new Map<string, ReturnType<typeof spendTracker>>();

function trackerOf(apiKey: string) {
	let tracker = trackers.get(apiKey);
	if (!tracker) {
		tracker = spendTracker({ read: () => keyUsage(apiKey) });
		trackers.set(apiKey, tracker);
	}
	return tracker;
}

/** What the key has spent: all its life, this month and this week; null if it cannot be asked. */
export async function keyUsage(apiKey: string) {
	try {
		const res = await fetch('https://openrouter.ai/api/v1/key', {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
		const { data } = await res.json();
		return {
			total: data.usage ?? 0,
			month: data.usage_monthly ?? 0,
			week: data.usage_weekly ?? 0
		};
	} catch (error) {
		console.warn('[ia] No se pudo consultar el gasto en OpenRouter', String(error));
		return null;
	}
}

watchCost((apiKey, label, cost) => {
	trackerOf(apiKey).add(label, cost);
	// And kept, for Gastos → IA.
	const familyId = familyOfKey(apiKey);
	if (familyId) void noteAiCost(familyId, 'nube', label, cost);
});

/** A page of the family showing the line: told now and on every change. */
export const watchAiSpend = (apiKey: string, listener: (spend: AiSpend | null) => void) =>
	trackerOf(apiKey).watch(listener);

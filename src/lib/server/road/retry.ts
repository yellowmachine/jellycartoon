/**
 * A gateway without an answer from behind it (502, 503, 504): it happens now and then on
 * openrouteservice's free plan, for a moment. Asked again after these waits, before giving up.
 */
const RETRY_STATUSES = new Set([502, 503, 504]);
const RETRY_AFTER_MS = [1000, 3000];

/** `ask` again while it answers a gateway's error; the last answer, and whether it still is one. */
export async function withRetries(
	ask: () => Promise<Response>,
	{ waits = RETRY_AFTER_MS, onRetry }: { waits?: number[]; onRetry?: (status: number) => void } = {}
) {
	let res = await ask();
	for (const wait of waits) {
		if (!RETRY_STATUSES.has(res.status)) break;
		onRetry?.(res.status);
		await new Promise((resolve) => setTimeout(resolve, wait));
		res = await ask();
	}
	return { res, unavailable: RETRY_STATUSES.has(res.status) };
}

import { expect, test } from 'bun:test';
import { withRetries } from './retry.ts';

/** Answers with these statuses in turn; how many times it was asked. */
function answers(...statuses: number[]) {
	let asked = 0;
	const ask = async () =>
		new Response(null, { status: statuses[Math.min(asked++, statuses.length - 1)] });
	return { ask, asked: () => asked };
}

test('a 502 for a moment: asked again, and the answer comes', async () => {
	const { ask, asked } = answers(502, 200);
	const retried: number[] = [];
	const { res, unavailable } = await withRetries(ask, {
		waits: [1, 1],
		onRetry: (s) => retried.push(s)
	});
	expect([res.status, unavailable, asked(), retried]).toEqual([200, false, 2, [502]]);
});

test('still failing after the retries: unavailable', async () => {
	const { ask, asked } = answers(502, 503, 504);
	const { unavailable } = await withRetries(ask, { waits: [1, 1] });
	expect([unavailable, asked()]).toEqual([true, 3]);
});

test('other errors are not asked again', async () => {
	const { ask, asked } = answers(400);
	const { res, unavailable } = await withRetries(ask, { waits: [1, 1] });
	expect([res.status, unavailable, asked()]).toEqual([400, false, 1]);
});

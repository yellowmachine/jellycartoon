import { describe, expect, test } from 'bun:test';
import { poll } from './poll.ts';

/** A document that is only its visibility. */
function fakeDocument(hidden = false) {
	const doc = new EventTarget() as EventTarget & { hidden: boolean };
	doc.hidden = hidden;
	return {
		doc: doc as unknown as Document,
		set(value: boolean) {
			doc.hidden = value;
			doc.dispatchEvent(new Event('visibilitychange'));
		}
	};
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('poll', () => {
	test('shown: every few milliseconds, until stopped', async () => {
		const { doc } = fakeDocument();
		let calls = 0;
		const stop = poll(() => calls++, 10, doc);
		await wait(55);
		stop();
		const atStop = calls;
		expect(atStop).toBeGreaterThanOrEqual(3);
		await wait(30);
		expect(calls).toBe(atStop);
	});

	test('hidden: nothing; shown again: at once, and then on', async () => {
		const page = fakeDocument(true);
		let calls = 0;
		const stop = poll(() => calls++, 10, page.doc);
		await wait(40);
		expect(calls).toBe(0);
		page.set(false);
		expect(calls).toBe(1);
		await wait(35);
		expect(calls).toBeGreaterThanOrEqual(3);
		page.set(true);
		const atHide = calls;
		await wait(30);
		expect(calls).toBe(atHide);
		stop();
	});

	test('a slow refresh is never overlapped by the next', async () => {
		const { doc } = fakeDocument();
		let running = 0;
		let most = 0;
		const stop = poll(
			async () => {
				most = Math.max(most, ++running);
				await wait(25);
				running--;
			},
			5,
			doc
		);
		await wait(100);
		stop();
		expect(most).toBe(1);
	});

	test('a failed refresh does not stop it', async () => {
		const { doc } = fakeDocument();
		let calls = 0;
		const stop = poll(
			() => {
				calls++;
				throw new Error('Sin conexión');
			},
			10,
			doc
		);
		await wait(45);
		stop();
		expect(calls).toBeGreaterThanOrEqual(2);
	});
});

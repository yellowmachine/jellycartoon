import { describe, expect, test } from 'bun:test';
import { inOrder } from './in-order.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

/** Like mpv's playlist: `replace` empties it, `append` adds to it; each command takes a moment. */
function fakePlayer() {
	const playlist: string[] = [];
	return {
		playlist,
		async play(items: string[]) {
			for (const [i, item] of items.entries()) {
				await tick();
				if (i === 0) playlist.length = 0;
				playlist.push(item);
			}
		}
	};
}

describe('inOrder', () => {
	test('without it, two orders at once mix their queues (#45)', async () => {
		const mpv = fakePlayer();
		await Promise.all([mpv.play(['1', '2', '3']), mpv.play(['1', '2', '3'])]);
		expect(mpv.playlist).toEqual(['1', '2', '2', '3', '3']);
	});

	test('with it, the second waits and replaces the first whole', async () => {
		const mpv = fakePlayer();
		const one = inOrder();
		await Promise.all([one(() => mpv.play(['1', '2', '3'])), one(() => mpv.play(['1', '2', '3']))]);
		expect(mpv.playlist).toEqual(['1', '2', '3']);
	});

	test('one that fails does not stop the next', async () => {
		const one = inOrder();
		const failed = one(async () => {
			throw new Error('mpv no responde');
		});
		const next = one(async () => 'ok');
		await expect(failed).rejects.toThrow('mpv no responde');
		expect(await next).toBe('ok');
	});
});

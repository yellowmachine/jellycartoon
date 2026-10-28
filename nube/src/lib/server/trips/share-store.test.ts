import { expect, test } from 'bun:test';
import { FORGET_MS, IDLE_MS, TOKEN, TripStore } from './share-store.ts';

const position = { lon: -4.02, lat: 39.86, t: 1, speed: 10, heading: 90 };

test('publish: a trip, and its news on top of what it had', () => {
	const store = new TripStore(() => 1000);
	store.publish('a', { name: 'Miguel', destination: 'Toledo' });
	const trip = store.publish('a', { position });
	expect(trip).toMatchObject({ name: 'Miguel', destination: 'Toledo', position, ended: false });
});

test('watch: each change, until stopped', () => {
	const store = new TripStore();
	const seen: boolean[] = [];
	const stop = store.watch('a', (t) => seen.push(t.ended));
	store.publish('a', { name: 'Miguel' });
	store.end('a');
	stop();
	store.publish('b', { name: 'Otro' });
	expect(seen).toEqual([false, true]);
});

test('end: no position any more, and it does not come back', () => {
	const store = new TripStore();
	store.publish('a', { name: 'Miguel', position });
	store.end('a');
	expect(store.publish('a', { position })).toMatchObject({ ended: true, position: null });
});

test('sweep: quiet ones end, ended ones are forgotten', () => {
	let now = 0;
	const store = new TripStore(() => now);
	store.publish('a', { name: 'Miguel' });
	now = IDLE_MS + 1;
	store.sweep();
	expect(store.get('a')?.ended).toBe(true);
	now += FORGET_MS + 1;
	store.sweep();
	expect(store.get('a')).toBeNull();
});

test('TOKEN: 16 random bytes in base64url', () => {
	expect(
		TOKEN.test(Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url'))
	).toBe(true);
	expect(TOKEN.test('../etc/passwd')).toBe(false);
});

import { describe, expect, mock, setSystemTime, test } from 'bun:test';

/** Watching together (#160): what counts for each, and who is free to join. */

const inserted: { userId: string; seconds: number }[] = [];
let watchers = ['lucia'];
mock.module('#lib/server/db/index.ts', () => ({
	db: {
		insert: () => ({
			values: (v: { userId: string; seconds: number }) => ({
				onConflictDoUpdate: async () => void inserted.push(v)
			})
		})
	}
}));
mock.module('#lib/server/kids.ts', () => ({
	isKidAccount: async () => true,
	KIDS_ROLE: 'infantil',
	allowedSeries: () => undefined
}));
mock.module('#lib/server/settings.ts', () => ({ keepsHistory: async () => true }));
mock.module('#lib/server/watching-together.ts', () => ({
	watchersOf: async (userId: string) => (userId === 'lucia' ? watchers : [userId])
}));

const { addWatchTime } = await import('./watch-time.ts');
const { watchingElsewhere } = await import('./live-watching.ts');
const { lowestAskEvery } = await import('./still-there.ts');

const seconds = (userId: string) =>
	inserted.filter((i) => i.userId === userId).reduce((sum, i) => sum + i.seconds, 0);

describe('watching together (#160)', () => {
	test('each one counts from when it joined', async () => {
		const episode = { episodeId: 7 };
		// Saved every 5 s, as the player does.
		let at = Date.now();
		const save = (positionSec: number) => {
			setSystemTime(new Date((at += 5000)));
			return addWatchTime('lucia', episode, positionSec, 'tv', 'la tele');
		};
		await save(0);
		await save(5);
		// Pablo joins.
		watchers = ['lucia', 'pablo'];
		await save(10);
		await save(15);
		setSystemTime();
		expect(seconds('lucia')).toBe(15);
		expect(seconds('pablo')).toBe(5);
	});

	test('one watching on its own device is not free to join', () => {
		// Lucía and Pablo are watching (the test above); Ana, nothing.
		const busy = watchingElsewhere(['lucia', 'pablo', 'ana'], new Set(['pablo']));
		expect([...busy]).toEqual(['lucia']);
	});

	test('«¿Sigues ahí?»: the lowest of the group; never, only if never for all', () => {
		expect(lowestAskEvery([3, null, 2])).toBe(2);
		expect(lowestAskEvery([null, null])).toBeNull();
	});
});

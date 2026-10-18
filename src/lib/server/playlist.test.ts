import { describe, expect, mock, test } from 'bun:test';

mock.module('#lib/server/db/index.ts', () => ({ db: {} }));
mock.module('#lib/server/kids.ts', () => ({ allowedSeries: () => undefined }));
const { pickEpisodes, suggestEpisodes } = await import('./playlist.ts');
type Candidate = import('./playlist.ts').Candidate;

function make(seriesId: number, count: number, opts: Partial<Candidate> = {}, watched = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: seriesId * 100 + i + 1,
		seriesId,
		serialized: true,
		season: 1,
		number: i + 1,
		durationSec: 600,
		completed: i < watched,
		watchedAt: i < watched ? new Date(2026, 0, i + 1) : null,
		...opts
	}));
}

describe('pickEpisodes', () => {
	test('serialized series continue from the first unwatched episode, in order', () => {
		const picked = pickEpisodes(make(1, 10, {}, 3), 30 * 60);
		expect(picked.map((e) => e.number)).toEqual([4, 5, 6]);
	});

	test('never repeats a series back to back while others remain', () => {
		for (let run = 0; run < 50; run++) {
			const picked = pickEpisodes([...make(1, 20), ...make(2, 20), ...make(3, 20)], 90 * 60);
			for (let i = 1; i < picked.length; i++) {
				expect(picked[i].seriesId).not.toBe(picked[i - 1].seriesId);
			}
		}
	});

	test('fills roughly the target duration', () => {
		const picked = pickEpisodes([...make(1, 20), ...make(2, 20)], 60 * 60);
		const total = picked.reduce((s, e) => s + e.durationSec, 0);
		expect(total).toBeGreaterThanOrEqual(60 * 60 * 0.9);
		expect(total).toBeLessThanOrEqual(60 * 60 * 1.15);
	});

	test('standalone series prefer unwatched episodes and never repeat', () => {
		const eps = make(1, 6, { serialized: false }, 4);
		const picked = pickEpisodes(eps, 30 * 60);
		expect(picked.map((e) => e.completed)).toEqual([false, false, true]);
		expect(new Set(picked.map((e) => e.id)).size).toBe(picked.length);
		// The watched one chosen is the one watched longest ago.
		expect(picked[2].number).toBe(1);
	});

	test('a single long episode still produces a playlist', () => {
		const picked = pickEpisodes(make(1, 2, { durationSec: 3 * 3600 }), 30 * 60);
		expect(picked).toHaveLength(1);
	});

	test('everything watched in a serialized series starts over', () => {
		const picked = pickEpisodes(make(1, 5, {}, 5), 20 * 60);
		expect(picked.map((e) => e.number)).toEqual([1, 2]);
	});
});

describe('suggestEpisodes', () => {
	const candidates = [
		...make(1, 5, {}, 2), // the one being watched
		...make(2, 4, {}, 1), // shares a tag: its 2nd is next
		...make(3, 3, {}, 3), // shares a tag, all watched: starts over
		...make(4, 6), // no tag in common: its 1st
		...make(5, 2)
	];

	test('one per other series, the one that is its turn; tag-sharing ones first', () => {
		const picked = suggestEpisodes(candidates, 1, 3, new Set([2, 3]));
		expect(picked).toHaveLength(3);
		expect(picked.map((e) => e.seriesId)).not.toContain(1);
		expect(new Set(picked.map((e) => e.seriesId)).size).toBe(3);
		expect(
			picked
				.slice(0, 2)
				.map((e) => e.id)
				.sort()
		).toEqual([202, 301]);
		expect([401, 501]).toContain(picked[2]!.id);
	});

	test('fewer series than asked: as many as there are', () => {
		expect(suggestEpisodes(make(1, 3).concat(make(2, 2)), 1, 3)).toHaveLength(1);
	});
});

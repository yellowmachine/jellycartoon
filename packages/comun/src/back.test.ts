import { afterEach, describe, expect, mock, test } from 'bun:test';
import { goBack } from './back.ts';

const g = globalThis as Record<string, unknown>;
const saved = { window: g.window, history: g.history };

function setUp(nav: { canGoBack: boolean } | undefined, length: number) {
	const back = mock(() => {});
	g.window = nav ? { navigation: nav } : {};
	g.history = { length, back };
	return back;
}

afterEach(() => {
	g.window = saved.window;
	g.history = saved.history;
});

describe('goBack', () => {
	test('goes back when the Navigation API says there is a page before', () => {
		const back = setUp({ canGoBack: true }, 1);
		const home = mock(() => {});
		goBack(home);
		expect(back).toHaveBeenCalledTimes(1);
		expect(home).not.toHaveBeenCalled();
	});

	test('goes home when opened straight on this page (from a notice)', () => {
		const back = setUp({ canGoBack: false }, 5);
		const home = mock(() => {});
		goBack(home);
		expect(back).not.toHaveBeenCalled();
		expect(home).toHaveBeenCalledTimes(1);
	});

	test('without the Navigation API, by the history length', () => {
		const home = mock(() => {});
		const backWithPages = setUp(undefined, 3);
		goBack(home);
		expect(backWithPages).toHaveBeenCalledTimes(1);
		expect(home).not.toHaveBeenCalled();

		const backAlone = setUp(undefined, 1);
		goBack(home);
		expect(backAlone).not.toHaveBeenCalled();
		expect(home).toHaveBeenCalledTimes(1);
	});
});

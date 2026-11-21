import { describe, expect, test } from 'bun:test';
import { mayTry, RETRY_MS, updatesOnNavigation, type NavigationState } from './app-update.ts';

const inVista = (path: string) => ['/vista', '/cocina', '/musica'].some((p) => path.startsWith(p));
const nav = (s: Partial<NavigationState>): NavigationState => ({
	from: '/',
	to: '/agenda',
	vistaShown: false,
	inVista,
	busy: false,
	...s
});

describe('a new version on the next page (#579)', () => {
	test('anywhere else, on the next page', () => {
		expect(updatesOnNavigation(nav({}))).toBe(true);
	});

	test('not while something a load would cut goes on', () => {
		expect(updatesOnNavigation(nav({ busy: true }))).toBe(false);
	});

	test('inside the Vista, from tab to tab, it waits', () => {
		expect(updatesOnNavigation(nav({ from: '/vista', to: '/musica', vistaShown: true }))).toBe(
			false
		);
	});

	test('leaving the Vista for another page, yes', () => {
		expect(updatesOnNavigation(nav({ from: '/vista', to: '/agenda', vistaShown: true }))).toBe(
			true
		);
	});

	test('the Vista off, its pages are the site as usual', () => {
		expect(updatesOnNavigation(nav({ from: '/agenda', to: '/musica' }))).toBe(true);
	});

	test('inside the road mode, no; leaving it, yes', () => {
		expect(updatesOnNavigation(nav({ from: '/carretera', to: '/carretera/listas' }))).toBe(false);
		expect(updatesOnNavigation(nav({ from: '/carretera/album', to: '/carretera' }))).toBe(false);
		expect(updatesOnNavigation(nav({ from: '/carretera', to: '/' }))).toBe(true);
	});

	test('a section that only starts like it is not the road mode', () => {
		expect(updatesOnNavigation(nav({ from: '/carreteras', to: '/carretera' }))).toBe(true);
	});
});

describe('tried without it working', () => {
	test('not again until a while later', () => {
		expect(mayTry(null, 0)).toBe(true);
		expect(mayTry(1000, 1000 + RETRY_MS - 1)).toBe(false);
		expect(mayTry(1000, 1000 + RETRY_MS)).toBe(true);
	});
});

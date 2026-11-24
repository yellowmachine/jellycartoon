import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_THEME,
	THEMES,
	isDarkTheme,
	isTheme,
	themeColor,
	themeCss,
	themeIsLight
} from './themes.ts';

/** The shades the app's classes use (see the comment in themes.ts). */
const USED = [
	...[100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => `zinc-${n}`),
	...[300, 400, 500, 600].map((n) => `amber-${n}`),
	...[300, 400, 500, 600].map((n) => `orange-${n}`),
	...[200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => `red-${n}`),
	...[300, 400, 500, 600, 950].map((n) => `emerald-${n}`),
	...[300, 400, 500].map((n) => `violet-${n}`),
	'green-300',
	'green-500',
	'white'
];

/** WCAG's contrast of two colours. */
function contrast(a: string, b: string) {
	const light = (hex: string) =>
		[0.2126, 0.7152, 0.0722].reduce((sum, part, i) => {
			const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
			return sum + part * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
		}, 0);
	const [low, high] = [light(a), light(b)].sort((x, y) => x - y) as [number, number];
	return (high + 0.05) / (low + 0.05);
}

describe('light themes', () => {
	const hues = ['amber', 'orange', 'red', 'emerald', 'green', 'violet', 'sky'];
	for (const theme of THEMES.filter((t) => themeIsLight(t.id))) {
		const c = theme.colors as Record<string, string>;
		const pairs: [string, string][] = [
			// Text on the page, the cards and the chips.
			...[100, 200, 300, 400, 500].flatMap((n) =>
				['zinc-950', 'zinc-900', 'zinc-800'].map((g): [string, string] => [`zinc-${n}`, g])
			),
			...hues.flatMap((h) =>
				[100, 200, 300, 400, 500].flatMap((n) =>
					['zinc-950', 'zinc-900', 'zinc-800'].map((g): [string, string] => [`${h}-${n}`, g])
				)
			),
			// A hue's text on its own tints.
			...hues.flatMap((h) =>
				[100, 200, 300].flatMap((n) =>
					[900, 950].map((g): [string, string] => [`${h}-${n}`, `${h}-${g}`])
				)
			),
			...hues.flatMap((h) => [900, 950].map((g): [string, string] => ['zinc-100', `${h}-${g}`])),
			// On buttons: the page's colour on the accent, white on the others.
			...['amber-400', 'amber-500', 'amber-600', 'violet-400', 'violet-500', 'lime-400'].map(
				(g): [string, string] => ['zinc-950', g]
			),
			...['red', 'emerald', 'green', 'sky', 'violet'].flatMap((h) =>
				[500, 600, 700].map((n): [string, string] => ['claro', `${h}-${n}`])
			)
		];
		test(`${theme.name}: its text reads (4,5:1)`, () => {
			const of = (name: string) => (name === 'claro' ? '#ffffff' : c[name]!);
			const bad = pairs
				.map(([t, g]) => `${t} / ${g}: ${contrast(of(t), of(g)).toFixed(2)}`)
				.filter((l) => Number(l.split(': ')[1]) < 4.5);
			expect(bad).toEqual([]);
		});
		test(`${theme.name}: the page's controls light, what stays dark with Tailwind's`, () => {
			const css = themeCss(theme.id);
			expect(css).toContain('color-scheme:light');
			expect(css).toContain('.tema-oscuro{--color-zinc-950:oklch(');
			expect(isTheme(theme.id)).toBe(true);
			// The house's are the dark ones.
			expect(isDarkTheme(theme.id)).toBe(false);
		});
	}
	test('every shade the app uses is turned round', () => {
		for (const theme of THEMES.filter((t) => themeIsLight(t.id)))
			for (const name of USED) expect(theme.colors).toHaveProperty([name]);
	});
});

describe('themes', () => {
	test('each one but the default gives every shade the app uses, as a colour', () => {
		for (const theme of THEMES) {
			if (theme.id === DEFAULT_THEME || themeIsLight(theme.id)) continue;
			const colors = theme.colors as Record<string, string>;
			expect(Object.keys(colors).sort()).toEqual([...USED].sort());
			for (const value of Object.values(colors)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	test('ids are unique; only known ones are themes', () => {
		expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
		expect(isTheme('gruvbox')).toBe(true);
		expect(isTheme('</style><script>')).toBe(false);
		expect(isTheme(null)).toBe(false);
	});

	test('the default leaves Tailwind as it is; the others redefine its variables', () => {
		expect(themeCss(DEFAULT_THEME)).toBe('');
		expect(themeCss('gruvbox')).toContain('--color-zinc-950:#1d2021');
		expect(themeColor('gruvbox')).toBe('#1d2021');
		// Unknown: the default, never the text it came with.
		expect(themeCss('</style><script>')).toBe('');
	});
});

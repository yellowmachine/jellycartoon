import { describe, expect, test } from 'bun:test';
import { DEFAULT_THEME, THEMES, isTheme, themeColor, themeCss } from './themes.ts';

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

describe('themes', () => {
	test('each one but the default gives every shade the app uses, as a colour', () => {
		for (const theme of THEMES) {
			if (theme.id === DEFAULT_THEME) continue;
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

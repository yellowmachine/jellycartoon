/**
 * The app's colours, chosen in Ajustes for each account. The interface is painted with Tailwind's
 * classes, and each class reads a CSS variable (`bg-zinc-900` → `--color-zinc-900`): a theme only
 * gives those variables other values, https://tailwindcss.com/docs/theme#using-your-theme-variables.
 *
 * The families the app uses: `zinc` (backgrounds, borders and text, 950 the page and 100 the text),
 * `amber` (the accent: buttons, the remote's focus), `orange` (the TV's titles), `red` (errors and
 * live), `emerald` (the radio), `violet` (music), `green`, and `white`. A theme without one keeps
 * Tailwind's. Not the channels' colours, the Música background (from the cover) or the subtitles'
 * style, which are the user's.
 */

export type ThemeId = (typeof THEMES)[number]['id'];

interface Theme {
	id: string;
	name: string;
	/** Tailwind colour → value, e.g. `zinc-950` → `#1d2021`. */
	colors: Record<string, string>;
}

export const DEFAULT_THEME = 'jellycartoon';

export const THEMES = [
	// Tailwind's own: zinc and amber.
	{ id: 'jellycartoon', name: 'JellyCartoon', colors: {} },
	{
		// https://github.com/morhetz/gruvbox
		id: 'gruvbox',
		name: 'Gruvbox',
		colors: {
			'zinc-950': '#1d2021',
			'zinc-900': '#282828',
			'zinc-800': '#3c3836',
			'zinc-700': '#504945',
			'zinc-600': '#665c54',
			'zinc-500': '#7c6f64',
			'zinc-400': '#a89984',
			'zinc-300': '#bdae93',
			'zinc-200': '#d5c4a1',
			'zinc-100': '#ebdbb2',
			white: '#fbf1c7',
			'amber-300': '#fcd36b',
			'amber-400': '#fabd2f',
			'amber-500': '#d79921',
			'amber-600': '#b57614',
			'orange-300': '#fe9f4d',
			'orange-400': '#fe8019',
			'orange-500': '#d65d0e',
			'orange-600': '#af3a03',
			'red-200': '#fdb7ad',
			'red-300': '#fc8475',
			'red-400': '#fb4934',
			'red-500': '#cc241d',
			'red-600': '#9d0006',
			'red-700': '#7c1d16',
			'red-800': '#5a1f1a',
			'red-900': '#3f1f1b',
			'red-950': '#2c1c19',
			'emerald-300': '#a9d394',
			'emerald-400': '#8ec07c',
			'emerald-500': '#689d6a',
			'emerald-600': '#427b58',
			'emerald-950': '#1f2b24',
			'violet-300': '#e3a9b9',
			'violet-400': '#d3869b',
			'violet-500': '#b16286',
			'green-300': '#b8bb26',
			'green-500': '#98971a'
		}
	},
	{
		// https://catppuccin.com/palette (Mocha)
		id: 'catppuccin',
		name: 'Catppuccin Mocha',
		colors: {
			'zinc-950': '#1e1e2e',
			'zinc-900': '#313244',
			'zinc-800': '#45475a',
			'zinc-700': '#585b70',
			'zinc-600': '#6c7086',
			'zinc-500': '#7f849c',
			'zinc-400': '#9399b2',
			'zinc-300': '#a6adc8',
			'zinc-200': '#bac2de',
			'zinc-100': '#cdd6f4',
			white: '#e6ebfb',
			'amber-300': '#fdf1dc',
			'amber-400': '#fbe9c4',
			'amber-500': '#f9e2af',
			'amber-600': '#e5c07b',
			'orange-300': '#fcd0b0',
			'orange-400': '#fab387',
			'orange-500': '#f5a06a',
			'orange-600': '#e08a50',
			'red-200': '#f9c8d6',
			'red-300': '#f5a5bd',
			'red-400': '#f38ba8',
			'red-500': '#e46a8d',
			'red-600': '#c95577',
			'red-700': '#8f3a52',
			'red-800': '#5e2b3c',
			'red-900': '#3d2230',
			'red-950': '#2b1d27',
			'emerald-300': '#b8f0e6',
			'emerald-400': '#94e2d5',
			'emerald-500': '#78cdbf',
			'emerald-600': '#5fb3a5',
			'emerald-950': '#1d2d2f',
			'violet-300': '#ddc5fa',
			'violet-400': '#cba6f7',
			'violet-500': '#b48ef0',
			'green-300': '#c3edc0',
			'green-500': '#a6e3a1'
		}
	},
	{
		// https://www.nordtheme.com/docs/colors-and-palettes
		id: 'nord',
		name: 'Nord',
		colors: {
			'zinc-950': '#2e3440',
			'zinc-900': '#3b4252',
			'zinc-800': '#434c5e',
			'zinc-700': '#4c566a',
			'zinc-600': '#5d6779',
			'zinc-500': '#76808f',
			'zinc-400': '#9aa3b3',
			'zinc-300': '#c0c8d6',
			'zinc-200': '#d8dee9',
			'zinc-100': '#e5e9f0',
			white: '#eceff4',
			'amber-300': '#c0dfe8',
			'amber-400': '#a3d0dc',
			'amber-500': '#88c0d0',
			'amber-600': '#6fa8b8',
			'orange-300': '#e0ab95',
			'orange-400': '#d08770',
			'orange-500': '#c0735b',
			'orange-600': '#a65f49',
			'red-200': '#e8c4c7',
			'red-300': '#d7959b',
			'red-400': '#bf616a',
			'red-500': '#a9525b',
			'red-600': '#8f444c',
			'red-700': '#6e3a42',
			'red-800': '#4f3138',
			'red-900': '#3d3036',
			'red-950': '#352f39',
			'emerald-300': '#c3d6b3',
			'emerald-400': '#a3be8c',
			'emerald-500': '#8faa78',
			'emerald-600': '#7a9465',
			'emerald-950': '#313a37',
			'violet-300': '#ccb3c8',
			'violet-400': '#b48ead',
			'violet-500': '#9e7898',
			'green-300': '#c3d6b3',
			'green-500': '#8faa78'
		}
	},
	{
		// https://draculatheme.com/spec
		id: 'dracula',
		name: 'Dracula',
		colors: {
			'zinc-950': '#282a36',
			'zinc-900': '#343746',
			'zinc-800': '#44475a',
			'zinc-700': '#525670',
			'zinc-600': '#6272a4',
			'zinc-500': '#7d88b5',
			'zinc-400': '#a3abcf',
			'zinc-300': '#c4c9e0',
			'zinc-200': '#e2e4ec',
			'zinc-100': '#f8f8f2',
			white: '#ffffff',
			'amber-300': '#d6bcfb',
			'amber-400': '#c9a6fa',
			'amber-500': '#bd93f9',
			'amber-600': '#a47de6',
			'orange-300': '#ffcf9e',
			'orange-400': '#ffb86c',
			'orange-500': '#f5a04f',
			'orange-600': '#e08a3a',
			'red-200': '#ffb3b3',
			'red-300': '#ff8080',
			'red-400': '#ff5555',
			'red-500': '#e64545',
			'red-600': '#c73a3a',
			'red-700': '#8f3036',
			'red-800': '#5e2a33',
			'red-900': '#3d2730',
			'red-950': '#31252f',
			'emerald-300': '#8cfca6',
			'emerald-400': '#50fa7b',
			'emerald-500': '#3fe068',
			'emerald-600': '#33c157',
			'emerald-950': '#213a30',
			'violet-300': '#ffa6d9',
			'violet-400': '#ff79c6',
			'violet-500': '#f05fb2',
			'green-300': '#8cfca6',
			'green-500': '#50fa7b'
		}
	},
	{
		// https://github.com/folke/tokyonight.nvim (Night)
		id: 'tokyonight',
		name: 'Tokyo Night',
		colors: {
			'zinc-950': '#1a1b26',
			'zinc-900': '#24283b',
			'zinc-800': '#292e42',
			'zinc-700': '#414868',
			'zinc-600': '#545c7e',
			'zinc-500': '#737aa2',
			'zinc-400': '#9aa5ce',
			'zinc-300': '#a9b1d6',
			'zinc-200': '#b4bde8',
			'zinc-100': '#c0caf5',
			white: '#d5dcfa',
			'amber-300': '#a9c1fa',
			'amber-400': '#8fb2f8',
			'amber-500': '#7aa2f7',
			'amber-600': '#5d87e0',
			'orange-300': '#ffbd94',
			'orange-400': '#ff9e64',
			'orange-500': '#f08a4b',
			'orange-600': '#d97536',
			'red-200': '#fbb9c5',
			'red-300': '#f99aab',
			'red-400': '#f7768e',
			'red-500': '#e05c75',
			'red-600': '#c24a61',
			'red-700': '#8a3a4c',
			'red-800': '#57303f',
			'red-900': '#3a2a38',
			'red-950': '#2a2231',
			'emerald-300': '#bde09a',
			'emerald-400': '#9ece6a',
			'emerald-500': '#85b552',
			'emerald-600': '#6e9a40',
			'emerald-950': '#222b22',
			'violet-300': '#d3bbfa',
			'violet-400': '#bb9af7',
			'violet-500': '#a07ee8',
			'green-300': '#bde09a',
			'green-500': '#9ece6a'
		}
	}
] as const satisfies readonly Theme[];

export const isTheme = (id: unknown): id is ThemeId => THEMES.some((t) => t.id === id);

export const themeOf = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

/**
 * Tailwind's variables with the theme's values, for a `<style>` in the head: the page comes from the
 * server already painted, with no flash of the default. Values only from the table above.
 */
export function themeCss(id: string) {
	const vars = Object.entries(themeOf(id).colors as Record<string, string>)
		.map(([name, value]) => `--color-${name}:${value}`)
		.join(';');
	return vars ? `<style>:root{${vars}}</style>` : '';
}

/** The browser's bar (`theme-color`) and the installed app's: the page's background. */
export const themeColor = (id: string) =>
	(themeOf(id).colors as Record<string, string>)['zinc-950'] ?? '#09090b';

/** A few colours of each, for its sample in Ajustes. */
export const themeSwatches = (id: string) => {
	const c = themeOf(id).colors as Record<string, string>;
	return [
		c['zinc-950'] ?? '#09090b',
		c['zinc-800'] ?? '#27272a',
		c['zinc-100'] ?? '#f4f4f5',
		c['amber-500'] ?? '#f59e0b',
		c['red-400'] ?? '#f87171',
		c['emerald-400'] ?? '#34d399',
		c['violet-400'] ?? '#a78bfa'
	];
};

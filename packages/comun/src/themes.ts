/**
 * The app's colours, chosen in Ajustes for each account. The interface is painted with Tailwind's
 * classes, and each class reads a CSS variable (`bg-zinc-900` → `--color-zinc-900`): a theme only
 * gives those variables other values, https://tailwindcss.com/docs/theme#using-your-theme-variables.
 *
 * The families the app uses: `zinc` (backgrounds, borders and text, 950 the page and 100 the text),
 * `amber` (the accent: buttons, the remote's focus), `orange` (the TV's titles), `red` (errors and
 * live), `emerald` (the radio), `violet` (music), `green`, and `white`. A theme without one keeps
 * Tailwind's. Fixed whatever the theme: `claro` (always white: what goes behind a product's picture or
 * a QR, and the text on a solid red, green, blue or violet) and `black`. Not the channels' colours, the Música background (from the cover) or the subtitles'
 * style, which are the user's.
 */

export type ThemeId = (typeof THEMES)[number]['id'];

interface Theme {
	id: string;
	name: string;
	/**
	 * A light one: the same scales the other way round (950, the page, is light; 100, the text,
	 * dark). Seilide's only: the house is seen on the TV.
	 */
	light?: true;
	/** Tailwind colour → value, e.g. `zinc-950` → `#1d2021`. */
	colors: Record<string, string>;
}

export const DEFAULT_THEME = 'jellycartoon';

/** Two colours mixed: `part` of the second. */
function mix(a: string, b: string, part: number) {
	const at = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
	return (
		'#' +
		[0, 1, 2]
			.map((i) => Math.round(at(a, i) * (1 - part) + at(b, i) * part))
			.map((n) => n.toString(16).padStart(2, '0'))
			.join('')
	);
}

/**
 * A light theme's shades from a few colours. Each hue's 400 is its text (dark enough on page, cards
 * and chips); 500 and 600, its buttons and bars; 300 to 100, its text on its own tint; 950 and 900,
 * those tints.
 */
function light(c: {
	/** The page, the cards, chips and what is hovered, the borders. */
	page: string;
	card: string;
	chip: string;
	border: string;
	faint: string;
	/** The secondary text, two steps, and the main one. */
	muted: string;
	soft: string;
	text: string;
	accent: string;
	red: string;
	green: string;
	violet: string;
	orange: string;
	sky: string;
}) {
	const hue = (name: string, base: string) => ({
		[`${name}-100`]: mix(base, c.text, 0.55),
		[`${name}-200`]: mix(base, c.text, 0.4),
		[`${name}-300`]: mix(base, c.text, 0.22),
		[`${name}-400`]: base,
		[`${name}-500`]: base,
		[`${name}-600`]: base,
		[`${name}-700`]: mix(base, c.text, 0.2),
		[`${name}-800`]: mix(base, c.page, 0.6),
		[`${name}-900`]: mix(base, c.page, 0.84),
		[`${name}-950`]: mix(base, c.page, 0.9)
	});
	return {
		'zinc-950': c.page,
		'zinc-900': c.card,
		'zinc-800': c.chip,
		'zinc-700': c.border,
		'zinc-600': c.faint,
		'zinc-500': c.muted,
		'zinc-400': c.soft,
		'zinc-300': mix(c.soft, c.text, 0.35),
		'zinc-200': mix(c.soft, c.text, 0.7),
		'zinc-100': c.text,
		'zinc-50': mix(c.text, '#000000', 0.3),
		white: mix(c.text, '#000000', 0.3),
		...hue('amber', c.accent),
		'amber-400': mix(c.accent, c.text, 0.1),
		// Only as borders and bars.
		'amber-700': mix(c.accent, c.page, 0.4),
		...hue('orange', c.orange),
		...hue('red', c.red),
		...hue('emerald', c.green),
		...hue('green', c.green),
		'lime-300': mix(c.green, c.text, 0.15),
		'lime-400': c.green,
		...hue('violet', c.violet),
		...hue('sky', c.sky)
	};
}

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
	},
	{
		// Seilide's own: light paper and the snail's green.
		id: 'caracol',
		name: 'Caracol',
		light: true,
		colors: light({
			page: '#f6f5ef',
			card: '#ffffff',
			chip: '#e9e7dd',
			border: '#d3d0c3',
			faint: '#8d8a7e',
			muted: '#66645b',
			soft: '#57554d',
			text: '#211f1b',
			accent: '#17693f',
			red: '#b3261e',
			green: '#17693f',
			violet: '#6d3fb0',
			orange: '#a4480f',
			sky: '#11608f'
		})
	},
	{
		// https://github.com/morhetz/gruvbox (light), some darkened to be read
		id: 'gruvbox-claro',
		name: 'Gruvbox claro',
		light: true,
		colors: light({
			page: '#fbf1c7',
			card: '#f2e5bc',
			chip: '#ebdbb2',
			border: '#d5c4a1',
			faint: '#928374',
			muted: '#665c54',
			soft: '#504945',
			text: '#282828',
			accent: '#a83702',
			red: '#9d0006',
			green: '#356347',
			violet: '#8f3f71',
			orange: '#a83702',
			sky: '#076678'
		})
	},
	{
		// https://catppuccin.com/palette (Latte), some darkened to be read
		id: 'catppuccin-latte',
		name: 'Catppuccin Latte',
		light: true,
		colors: light({
			page: '#eff1f5',
			card: '#ffffff',
			chip: '#e6e9ef',
			border: '#bcc0cc',
			faint: '#8c8fa1',
			muted: '#5f6278',
			soft: '#5c5f77',
			text: '#4c4f69',
			accent: '#7c2fe0',
			red: '#c00d34',
			green: '#12686d',
			violet: '#7c2fe0',
			orange: '#a8430a',
			sky: '#1a5fb4'
		})
	},
	{
		// https://rosepinetheme.com/palette (Dawn), some darkened to be read
		id: 'rose-pine-dawn',
		name: 'Rosé Pine Dawn',
		light: true,
		colors: light({
			page: '#faf4ed',
			card: '#fffaf3',
			chip: '#f2e9e1',
			border: '#dfdad9',
			faint: '#9893a5',
			muted: '#676380',
			soft: '#625d7f',
			text: '#464261',
			accent: '#286983',
			red: '#a8435f',
			green: '#286983',
			violet: '#7a5c96',
			orange: '#9a4f1c',
			sky: '#286983'
		})
	}
] as const satisfies readonly Theme[];

export const isTheme = (id: unknown): id is ThemeId => THEMES.some((t) => t.id === id);

/** A dark one: the house's. */
export const isDarkTheme = (id: unknown): id is ThemeId =>
	THEMES.some((t) => t.id === id && !isLight(t));

const isLight = (theme: Theme) => theme.light === true;

export const themeOf = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0];

export const themeIsLight = (id: string) => isLight(themeOf(id));

/**
 * Tailwind's own values (tailwindcss/theme.css) of what a light theme turns round, for what stays
 * dark over it (`.tema-oscuro`): a video's controls, a photo full screen, the screen at rest.
 */
const DARK: Record<string, string> = {
	'zinc-950': 'oklch(14.1% 0.005 285.823)',
	'zinc-900': 'oklch(21% 0.006 285.885)',
	'zinc-800': 'oklch(27.4% 0.006 286.033)',
	'zinc-700': 'oklch(37% 0.013 285.805)',
	'zinc-600': 'oklch(44.2% 0.017 285.786)',
	'zinc-500': 'oklch(55.2% 0.016 285.938)',
	'zinc-400': 'oklch(70.5% 0.015 286.067)',
	'zinc-300': 'oklch(87.1% 0.006 286.286)',
	'zinc-200': 'oklch(92% 0.004 286.32)',
	'zinc-100': 'oklch(96.7% 0.001 286.375)',
	'zinc-50': 'oklch(98.5% 0 none)',
	white: '#fff',
	'amber-100': 'oklch(96.2% 0.059 95.617)',
	'amber-200': 'oklch(92.4% 0.12 95.746)',
	'amber-300': 'oklch(87.9% 0.169 91.605)',
	'amber-400': 'oklch(82.8% 0.189 84.429)',
	'amber-500': 'oklch(76.9% 0.188 70.08)',
	'amber-600': 'oklch(66.6% 0.179 58.318)',
	'amber-700': 'oklch(55.5% 0.163 48.998)',
	'amber-800': 'oklch(47.3% 0.137 46.201)',
	'amber-900': 'oklch(41.4% 0.112 45.904)',
	'amber-950': 'oklch(27.9% 0.077 45.635)',
	'orange-100': 'oklch(95.4% 0.038 75.164)',
	'orange-200': 'oklch(90.1% 0.076 70.697)',
	'orange-300': 'oklch(83.7% 0.128 66.29)',
	'orange-400': 'oklch(75% 0.183 55.934)',
	'orange-500': 'oklch(70.5% 0.213 47.604)',
	'orange-600': 'oklch(64.6% 0.222 41.116)',
	'orange-700': 'oklch(55.3% 0.195 38.402)',
	'orange-800': 'oklch(47% 0.157 37.304)',
	'orange-900': 'oklch(40.8% 0.123 38.172)',
	'orange-950': 'oklch(26.6% 0.079 36.259)',
	'red-100': 'oklch(93.6% 0.032 17.717)',
	'red-200': 'oklch(88.5% 0.062 18.334)',
	'red-300': 'oklch(80.8% 0.114 19.571)',
	'red-400': 'oklch(70.4% 0.191 22.216)',
	'red-500': 'oklch(63.7% 0.237 25.331)',
	'red-600': 'oklch(57.7% 0.245 27.325)',
	'red-700': 'oklch(50.5% 0.213 27.518)',
	'red-800': 'oklch(44.4% 0.177 26.899)',
	'red-900': 'oklch(39.6% 0.141 25.723)',
	'red-950': 'oklch(25.8% 0.092 26.042)',
	'emerald-100': 'oklch(95% 0.052 163.051)',
	'emerald-200': 'oklch(90.5% 0.093 164.15)',
	'emerald-300': 'oklch(84.5% 0.143 164.978)',
	'emerald-400': 'oklch(76.5% 0.177 163.223)',
	'emerald-500': 'oklch(69.6% 0.17 162.48)',
	'emerald-600': 'oklch(59.6% 0.145 163.225)',
	'emerald-700': 'oklch(50.8% 0.118 165.612)',
	'emerald-800': 'oklch(43.2% 0.095 166.913)',
	'emerald-900': 'oklch(37.8% 0.077 168.94)',
	'emerald-950': 'oklch(26.2% 0.051 172.552)',
	'green-100': 'oklch(96.2% 0.044 156.743)',
	'green-200': 'oklch(92.5% 0.084 155.995)',
	'green-300': 'oklch(87.1% 0.15 154.449)',
	'green-400': 'oklch(79.2% 0.209 151.711)',
	'green-500': 'oklch(72.3% 0.219 149.579)',
	'green-600': 'oklch(62.7% 0.194 149.214)',
	'green-700': 'oklch(52.7% 0.154 150.069)',
	'green-800': 'oklch(44.8% 0.119 151.328)',
	'green-900': 'oklch(39.3% 0.095 152.535)',
	'green-950': 'oklch(26.6% 0.065 152.934)',
	'lime-300': 'oklch(89.7% 0.196 126.665)',
	'lime-400': 'oklch(84.1% 0.238 128.85)',
	'violet-100': 'oklch(94.3% 0.029 294.588)',
	'violet-200': 'oklch(89.4% 0.057 293.283)',
	'violet-300': 'oklch(81.1% 0.111 293.571)',
	'violet-400': 'oklch(70.2% 0.183 293.541)',
	'violet-500': 'oklch(60.6% 0.25 292.717)',
	'violet-600': 'oklch(54.1% 0.281 293.009)',
	'violet-700': 'oklch(49.1% 0.27 292.581)',
	'violet-800': 'oklch(43.2% 0.232 292.759)',
	'violet-900': 'oklch(38% 0.189 293.745)',
	'violet-950': 'oklch(28.3% 0.141 291.089)',
	'sky-100': 'oklch(95.1% 0.026 236.824)',
	'sky-200': 'oklch(90.1% 0.058 230.902)',
	'sky-300': 'oklch(82.8% 0.111 230.318)',
	'sky-400': 'oklch(74.6% 0.16 232.661)',
	'sky-500': 'oklch(68.5% 0.169 237.323)',
	'sky-600': 'oklch(58.8% 0.158 241.966)',
	'sky-700': 'oklch(50% 0.134 242.749)',
	'sky-800': 'oklch(44.3% 0.11 240.79)',
	'sky-900': 'oklch(39.1% 0.09 240.876)',
	'sky-950': 'oklch(29.3% 0.066 243.157)'
};

const variables = (colors: Record<string, string>) =>
	Object.entries(colors)
		.map(([name, value]) => `--color-${name}:${value}`)
		.join(';');

/**
 * Tailwind's variables with the theme's values, for a `<style>` in the head: the page comes from the
 * server already painted, with no flash of the default. Values only from the table above. A light
 * one also turns the browser's own controls light, and thickens the veils over pictures, so the dark
 * text reads on them (Backdrop, MusicBackground).
 */
export function themeCss(id: string) {
	const theme = themeOf(id);
	const vars = variables(theme.colors);
	if (!vars) return '';
	if (!isLight(theme)) return `<style>:root{${vars}}</style>`;
	return (
		`<style>:root{${vars};color-scheme:light;--velo:80%;--velo-alto:72%;--velo-medio:88%}` +
		`.tema-oscuro{${variables(DARK)};color-scheme:dark;color:var(--color-zinc-100)}</style>`
	);
}

/** The browser's bar (`theme-color`) and the installed app's: the page's background. */
export const themeColor = (id: string) => themeOf(id).colors['zinc-950'] ?? '#09090b';

/** A few colours of each, for its sample in Ajustes. */
export const themeSwatches = (id: string) => {
	const c = themeOf(id).colors;
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

/**
 * Subtitle appearance options. Only these fixed values ever reach the generated CSS, so a stored
 * style can never inject arbitrary CSS.
 */
export const SUBTITLE_OPTIONS = {
	font: {
		label: 'Fuente',
		choices: {
			sans: { label: 'Normal', css: 'system-ui, sans-serif' },
			legible: { label: 'Legible', css: '"Atkinson Hyperlegible", system-ui, sans-serif' },
			comic: { label: 'Cómic', css: '"Comic Neue", "Comic Sans MS", cursive' },
			serif: { label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
			mono: { label: 'Mono', css: 'ui-monospace, "DejaVu Sans Mono", monospace' },
			/** Arial in bold, as subtitled films had them; Liberation Sans is its free twin. */
			classic: {
				label: 'Clásica',
				css: '"Liberation Sans", Arial, Helvetica, sans-serif',
				bold: true
			}
		}
	},
	size: {
		label: 'Tamaño',
		choices: {
			s: { label: 'S', css: '0.8' },
			m: { label: 'M', css: '1' },
			l: { label: 'L', css: '1.25' },
			xl: { label: 'XL', css: '1.5' },
			xxl: { label: 'XXL', css: '2' }
		}
	},
	color: {
		label: 'Color',
		choices: {
			white: { label: 'Blanco', css: '#ffffff' },
			yellow: { label: 'Amarillo', css: '#ffe14d' },
			cyan: { label: 'Cian', css: '#5ce1ff' },
			green: { label: 'Verde', css: '#7dff8a' }
		}
	},
	background: {
		label: 'Fondo',
		choices: {
			none: { label: 'Ninguno', css: 'transparent' },
			soft: { label: 'Suave', css: 'rgb(0 0 0 / 0.45)' },
			solid: { label: 'Opaco', css: 'rgb(0 0 0 / 0.85)' }
		}
	},
	outline: {
		label: 'Contorno',
		choices: {
			none: { label: 'No', css: 'none' },
			shadow: { label: 'Sombra', css: '0 2px 4px rgb(0 0 0 / 0.9)' },
			thick: {
				label: 'Grueso',
				css: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 0 6px #000'
			}
		}
	}
} as const;

type Options = typeof SUBTITLE_OPTIONS;
export type SubtitleStyle = { [K in keyof Options]: keyof Options[K]['choices'] };

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
	font: 'sans',
	size: 'm',
	color: 'white',
	background: 'soft',
	outline: 'shadow'
};

/** Keeps only known keys and values, filling the rest with defaults. */
export function sanitizeSubtitleStyle(value: unknown): SubtitleStyle {
	const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	const style = { ...DEFAULT_SUBTITLE_STYLE } as Record<string, string>;
	for (const [key, option] of Object.entries(SUBTITLE_OPTIONS)) {
		const chosen = input[key];
		if (typeof chosen === 'string' && chosen in option.choices) style[key] = chosen;
	}
	return style as SubtitleStyle;
}

/** Whole styles, chosen at once. */
export const SUBTITLE_PRESETS: { label: string; style: SubtitleStyle }[] = [
	{
		// Films in original version on TV and on video: yellow, bold, outlined, no box.
		label: 'Versión original',
		style: { font: 'classic', size: 'm', color: 'yellow', background: 'none', outline: 'thick' }
	}
];

const choice = <K extends keyof Options>(style: SubtitleStyle, key: K) =>
	(SUBTITLE_OPTIONS[key].choices as Record<string, { css: string; bold?: boolean }>)[
		style[key] as string
	];

export function subtitleCss(style: SubtitleStyle) {
	const css = <K extends keyof Options>(key: K) => choice(style, key).css;
	return {
		fontFamily: css('font'),
		fontWeight: choice(style, 'font').bold ? 700 : 400,
		/** Multiplier over the browser's default cue size. */
		fontScale: Number(css('size')),
		color: css('color'),
		background: css('background'),
		textShadow: css('outline')
	};
}

/** For mpv: the font family it asks fontconfig for, by the browser's choice. */
const MPV_FONTS: Record<SubtitleStyle['font'], string> = {
	sans: 'sans-serif',
	legible: 'Atkinson Hyperlegible',
	comic: 'Comic Neue',
	serif: 'serif',
	mono: 'monospace',
	classic: 'Liberation Sans'
};

/** `#rrggbb` and an opacity as mpv's `#AARRGGBB` (alpha first). */
const mpvColor = (hex: string, opacity = 1) =>
	`#${Math.round(opacity * 255)
		.toString(16)
		.padStart(2, '0')}${hex.slice(1)}`.toUpperCase();

/**
 * The same style for mpv in the living room, as its properties: https://mpv.io/manual/stable/#subtitles.
 * They apply to text subtitles (SRT, WebVTT, the made ones); ASS keep their own look and image
 * ones (DVD, Blu-ray) cannot change.
 */
export function mpvSubtitleProperties(style: SubtitleStyle): [string, string | number | boolean][] {
	const box = { none: 0, soft: 0.45, solid: 0.85 }[style.background];
	const outline = { none: [0, 0], shadow: [1, 2], thick: [3.5, 0] }[style.outline];
	return [
		['sub-font', MPV_FONTS[style.font]],
		['sub-bold', Boolean(choice(style, 'font').bold)],
		['sub-scale', Number(choice(style, 'size').css)],
		['sub-color', mpvColor(choice(style, 'color').css)],
		// A box behind the text, or the outline and its shadow.
		['sub-border-style', box ? 'background-box' : 'outline-and-shadow'],
		['sub-back-color', box ? mpvColor('#000000', box) : mpvColor('#000000', 0.9)],
		['sub-border-color', '#FF000000'],
		['sub-border-size', outline[0]!],
		['sub-shadow-offset', outline[1]!]
	];
}

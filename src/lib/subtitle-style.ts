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
			mono: { label: 'Mono', css: 'ui-monospace, "DejaVu Sans Mono", monospace' }
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

export function subtitleCss(style: SubtitleStyle) {
	const css = <K extends keyof Options>(key: K) =>
		(SUBTITLE_OPTIONS[key].choices as Record<string, { css: string }>)[style[key] as string].css;
	return {
		fontFamily: css('font'),
		/** Multiplier over the browser's default cue size. */
		fontScale: Number(css('size')),
		color: css('color'),
		background: css('background'),
		textShadow: css('outline')
	};
}

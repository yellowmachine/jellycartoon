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
	},
	/**
	 * How high: some prefer them a little up, nearer the middle of the picture, for the eyes to
	 * travel less. Its value is where their bottom goes, as a % of the height from the top; `auto`,
	 * the player's own place.
	 */
	position: {
		label: 'Posición',
		choices: {
			bottom: { label: 'Abajo', css: 'auto' },
			raised: { label: 'Algo más arriba', css: '88' },
			high: { label: 'Más arriba', css: '80' }
		}
	},
	/**
	 * Whisper's only (#86): with quick talk two are on screen, and how. Not CSS: the subtitles are
	 * made in this form when asked for (`formCues`), also for mpv.
	 */
	automatic: {
		label: 'Automáticos',
		choices: {
			single: { label: 'Una línea', css: '' },
			blocks: { label: 'Dos líneas fijas', css: '' },
			rollup: { label: 'Suben', css: '' },
			rollupDim: { label: 'Suben, la de arriba en gris', css: '' }
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
	position: 'bottom',
	outline: 'shadow',
	automatic: 'blocks'
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

/** Whole looks, chosen at once; where they go (position) and how Whisper's show stay as they were. */
export const SUBTITLE_PRESETS: {
	label: string;
	style: Omit<SubtitleStyle, 'position' | 'automatic'>;
}[] = [
	{
		// Films in original version on TV and on video: yellow, bold, outlined, no box.
		label: 'Versión original',
		style: { font: 'classic', size: 'm', color: 'yellow', background: 'none', outline: 'thick' }
	},
	{
		// Netflix, HBO and the like: white, plain, a soft shadow, no box.
		label: 'Plataformas',
		style: { font: 'sans', size: 'm', color: 'white', background: 'none', outline: 'shadow' }
	},
	{
		// TVE's 888 and the BBC's: coloured letters on a black box.
		label: 'Teletexto',
		style: { font: 'mono', size: 'm', color: 'yellow', background: 'solid', outline: 'none' }
	},
	{
		// To read fast: a font made for it, bigger, on a box.
		label: 'Fácil de leer',
		style: { font: 'legible', size: 'l', color: 'white', background: 'solid', outline: 'none' }
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
		textShadow: css('outline'),
		/** Where their bottom goes (placeCues): % of the height, or `auto`. */
		line: css('position')
	};
}

/**
 * The chosen height on a browser's cues: set on each one as it shows (`cuechange`), of every text
 * track the video has or gets (hls.js adds them as it goes). `line()` is read each time, so a new
 * choice applies from the next cue. Returns what stops it.
 */
export function placeCues(video: HTMLVideoElement, line: () => string) {
	const place = (track: TextTrack) => {
		const at = line();
		for (const cue of Array.from(track.activeCues ?? []) as VTTCue[]) {
			if (at === 'auto') {
				cue.snapToLines = true;
				cue.lineAlign = 'start';
				cue.line = 'auto';
			} else {
				// Its bottom there, however many lines it has.
				cue.snapToLines = false;
				cue.lineAlign = 'end';
				cue.line = Number(at);
			}
		}
	};
	const listeners = new Map<TextTrack, () => void>();
	const follow = (track: TextTrack) => {
		if (listeners.has(track)) return;
		const listener = () => place(track);
		listeners.set(track, listener);
		track.addEventListener('cuechange', listener);
	};
	const tracks = video.textTracks;
	for (const track of Array.from(tracks)) follow(track);
	const added = (e: TrackEvent) => e.track && follow(e.track as TextTrack);
	tracks.addEventListener('addtrack', added);
	return {
		/** Now, on the cues showing: the choice changed. */
		again: () => listeners.forEach((_, track) => place(track)),
		stop: () => {
			tracks.removeEventListener('addtrack', added);
			listeners.forEach((listener, track) => track.removeEventListener('cuechange', listener));
		}
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
		['sub-shadow-offset', outline[1]!],
		// Where their bottom goes, in % of the height from the top, as for the browser's.
		['sub-pos', { bottom: 100, raised: 88, high: 80 }[style.position]]
	];
}

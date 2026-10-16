/**
 * The Música background: an aurora with the colours of the cover of what is playing. Large blurred
 * blobs of colour drift slowly over a very dark ground, made from the cover's own colours, darkened
 * and calmer so that they do not compete with the text. Painted tiny and scaled up: the browser's
 * smoothing is the blur, almost for free.
 */

export interface Hsl {
	h: number;
	s: number;
	l: number;
}

export interface Palette {
	bg: Hsl;
	/** Always four: when the cover gives fewer, they repeat. */
	ink: [Hsl, Hsl, Hsl, Hsl];
}

export const hsl = (c: Hsl, a = 1) =>
	`hsl(${c.h.toFixed(0)} ${(c.s * 100).toFixed(0)}% ${(c.l * 100).toFixed(0)}% / ${a})`;

function rgbToHsl(r: number, g: number, b: number): Hsl {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return { h: 0, s: 0, l };
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h =
		max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return { h: h * 60, s, l };
}

const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * The image's main colours, the ones that cover most first: median cut
 * (https://en.wikipedia.org/wiki/Median_cut) over its pixels, as `[r, g, b, …]`.
 */
export function mainColors(pixels: ArrayLike<number>, count = 8): Hsl[] {
	type Box = number[][];
	const all: Box = [];
	for (let i = 0; i + 2 < pixels.length; i += 4)
		all.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
	let boxes: Box[] = [all];
	const range = (box: Box, c: number) =>
		Math.max(...box.map((p) => p[c])) - Math.min(...box.map((p) => p[c]));
	while (boxes.length < count) {
		const widest = boxes
			.filter((b) => b.length > 1)
			.map((box) => ({
				box,
				c: [0, 1, 2].reduce((a, c) => (range(box, c) > range(box, a) ? c : a), 0)
			}))
			.sort((a, b) => range(b.box, b.c) - range(a.box, a.c))[0];
		if (!widest || range(widest.box, widest.c) === 0) break;
		const sorted = [...widest.box].sort((a, b) => a[widest.c] - b[widest.c]);
		const half = sorted.length >> 1;
		boxes = [...boxes.filter((b) => b !== widest.box), sorted.slice(0, half), sorted.slice(half)];
	}
	return boxes
		.filter((b) => b.length)
		.sort((a, b) => b.length - a.length)
		.map((box) => {
			const avg = [0, 1, 2].map((c) => box.reduce((s, p) => s + p[c], 0) / box.length);
			return rgbToHsl(avg[0], avg[1], avg[2]);
		});
}

/** Without whites nor blacks, up to four that differ, darkened and calmer. */
export function palette(colors: Hsl[]): Palette {
	let usable = colors.filter((c) => c.l > 0.07 && c.l < 0.9);
	if (!usable.length) usable = colors.length ? colors : [{ h: 38, s: 0.5, l: 0.4 }];
	const picked: Hsl[] = [];
	for (const c of usable) {
		const close = picked.some((p) =>
			p.s < 0.12 || c.s < 0.12
				? Math.abs(p.l - c.l) < 0.12
				: hueGap(p.h, c.h) < 22 && Math.abs(p.l - c.l) < 0.15
		);
		if (!close) picked.push(c);
		if (picked.length === 4) break;
	}
	while (picked.length < 3) {
		const last = picked[picked.length - 1];
		picked.push({ ...last, l: last.l + 0.12 });
	}
	const ink = picked.map((c, i) => ({
		h: c.h,
		// Greys stay grey; colours, never too loud.
		s: Math.min(c.s < 0.12 ? c.s : Math.max(c.s, 0.3), 0.62),
		l: 0.42 + i * 0.05
	}));
	return {
		bg: { h: picked[0].h, s: Math.min(picked[0].s, 0.4) * 0.7, l: 0.055 },
		ink: [0, 1, 2, 3].map((i) => ink[i % ink.length]) as Palette['ink']
	};
}

const covers = new Map<string, Promise<Palette | null>>();

/** The palette of a cover image (same origin), worked out once per address. */
export function coverPalette(url: string): Promise<Palette | null> {
	let found = covers.get(url);
	if (!found) {
		found = (async () => {
			const img = new Image();
			img.src = url;
			try {
				await img.decode();
			} catch {
				return null;
			}
			// A few hundred pixels say enough of its colours.
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = 24;
			const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
			ctx.drawImage(img, 0, 0, 24, 24);
			return palette(mainColors(ctx.getImageData(0, 0, 24, 24).data));
		})();
		covers.set(url, found);
	}
	return found;
}

/** A step of `amount` from `a` towards `b`, the hue the short way round. */
function mix(a: Hsl, b: Hsl, amount: number): Hsl {
	let dh = b.h - a.h;
	if (dh > 180) dh -= 360;
	if (dh < -180) dh += 360;
	return {
		h: (a.h + dh * amount + 360) % 360,
		s: a.s + (b.s - a.s) * amount,
		l: a.l + (b.l - a.l) * amount
	};
}

export function mixPalette(a: Palette, b: Palette, amount: number): Palette {
	return {
		bg: mix(a.bg, b.bg, amount),
		ink: a.ink.map((c, i) => mix(c, b.ink[i], amount)) as Palette['ink']
	};
}

/** The blobs: each its colour, its pace and its size. Fixed, so that changing album only changes colour. */
const BLOBS = [
	{ c: 0, fx: 0.041, fy: 0.033, px: 0.4, py: 2.1, rad: 0.55 },
	{ c: 1, fx: 0.029, fy: 0.052, px: 2.6, py: 4.4, rad: 0.45 },
	{ c: 2, fx: 0.057, fy: 0.037, px: 4.9, py: 0.9, rad: 0.4 },
	{ c: 3, fx: 0.034, fy: 0.046, px: 1.7, py: 5.6, rad: 0.5 },
	{ c: 0, fx: 0.048, fy: 0.027, px: 5.8, py: 3.3, rad: 0.35 }
];

const W = 64;
const H = 40;
let small: HTMLCanvasElement | null = null;

/** One frame at time `t` (seconds of drift), `intensity` from 0 to 1. */
export function drawAurora(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	t: number,
	p: Palette,
	intensity: number
) {
	small ??= Object.assign(document.createElement('canvas'), { width: W, height: H });
	const s = small.getContext('2d')!;
	s.globalCompositeOperation = 'source-over';
	s.fillStyle = hsl(p.bg);
	s.fillRect(0, 0, W, H);
	s.globalCompositeOperation = 'lighter';
	for (const b of BLOBS) {
		const x = (0.5 + 0.42 * Math.sin(t * b.fx + b.px)) * W;
		const y = (0.5 + 0.42 * Math.sin(t * b.fy + b.py)) * H;
		const g = s.createRadialGradient(x, y, 0, x, y, b.rad * W);
		g.addColorStop(0, hsl(p.ink[b.c], 0.55 * intensity));
		g.addColorStop(1, hsl(p.ink[b.c], 0));
		s.fillStyle = g;
		s.fillRect(0, 0, W, H);
	}
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(small, 0, 0, w, h);
}

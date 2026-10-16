/**
 * The Música background: abstract shapes with the colours of the cover of what is playing, over a
 * very dark ground. The colours are the cover's own, darkened and calmer so that they do not compete
 * with the text; the shapes come from the album's id, so the same album always looks the same. Four
 * styles, chosen in Ajustes on each device.
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

export type BackgroundStyle = 'aurora' | 'orbits' | 'waves' | 'stars';

export const BACKGROUND_STYLES: { key: BackgroundStyle; label: string }[] = [
	{ key: 'aurora', label: 'Aurora' },
	{ key: 'orbits', label: 'Órbitas' },
	{ key: 'waves', label: 'Ondas' },
	{ key: 'stars', label: 'Constelación' }
];

/** The same album, the same drawing: randomness from a seed (mulberry32). */
function seeded(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const lighter = (c: Hsl, l: number): Hsl => ({ ...c, l });

/** The aurora's blobs: fixed, so that changing album only changes colour. */
const BLOBS = [
	{ c: 0, fx: 0.041, fy: 0.033, px: 0.4, py: 2.1, rad: 0.55 },
	{ c: 1, fx: 0.029, fy: 0.052, px: 2.6, py: 4.4, rad: 0.45 },
	{ c: 2, fx: 0.057, fy: 0.037, px: 4.9, py: 0.9, rad: 0.4 },
	{ c: 3, fx: 0.034, fy: 0.046, px: 1.7, py: 5.6, rad: 0.5 },
	{ c: 0, fx: 0.048, fy: 0.027, px: 5.8, py: 3.3, rad: 0.35 }
];

/** The shapes of each style, built once per album from its id. */
function build(style: BackgroundStyle, seed: number) {
	const r = seeded(seed * 7919 + BACKGROUND_STYLES.findIndex((s) => s.key === style) * 104729);
	const pick = () => Math.floor(r() * 4);
	switch (style) {
		case 'aurora':
			return { kind: 'aurora' as const, blobs: BLOBS };
		case 'orbits':
			return {
				kind: 'orbits' as const,
				cx: 0.66 + r() * 0.14,
				cy: 0.38 + r() * 0.2,
				rings: Array.from({ length: 7 + Math.floor(r() * 4) }, (_, i) => ({
					k: 0.09 + i * (0.075 + r() * 0.02),
					c: pick(),
					arc: 0.6 + r() * 1.3 * Math.PI,
					rot: r() * 6.3,
					dir: r() < 0.5 ? -1 : 1,
					dot: r() < 0.55,
					w: r() < 0.2 ? 2 : 1
				}))
			};
		case 'waves':
			return {
				kind: 'waves' as const,
				lines: Array.from({ length: 8 }, (_, i) => ({
					c: i % 4,
					y: 0.18 + i * 0.09 + r() * 0.03,
					a1: 0.03 + r() * 0.05,
					f1: 1 + r() * 2.2,
					a2: 0.01 + r() * 0.025,
					f2: 3 + r() * 4,
					ph: r() * 6.3,
					v: 0.08 + r() * 0.12
				}))
			};
		default:
			return {
				kind: 'stars' as const,
				points: Array.from({ length: 46 }, () => ({
					x: r(),
					y: r(),
					vx: (r() - 0.5) * 0.012,
					vy: (r() - 0.5) * 0.012,
					s: 0.6 + r() * 1.8,
					c: pick(),
					big: r() < 0.08
				}))
			};
	}
}

type Shapes = ReturnType<typeof build>;
const shapes = new Map<string, Shapes>();

const W = 64;
const H = 40;
let small: HTMLCanvasElement | null = null;

/**
 * One frame of `style` for the album `seed`, at time `t` (seconds of drift), `intensity` from 0 to
 * 1. The aurora is painted tiny and scaled up, the browser's smoothing is its blur; the others are
 * thin lines and dots, at the canvas' size.
 */
export function drawBackground(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	style: BackgroundStyle,
	seed: number,
	t: number,
	p: Palette,
	intensity: number
) {
	const key = `${style}:${seed}`;
	let s = shapes.get(key);
	if (!s) shapes.set(key, (s = build(style, seed)));
	const k = intensity;

	if (s.kind === 'aurora') {
		small ??= Object.assign(document.createElement('canvas'), { width: W, height: H });
		const sc = small.getContext('2d')!;
		sc.globalCompositeOperation = 'source-over';
		sc.fillStyle = hsl(p.bg);
		sc.fillRect(0, 0, W, H);
		sc.globalCompositeOperation = 'lighter';
		for (const b of s.blobs) {
			const x = (0.5 + 0.42 * Math.sin(t * b.fx + b.px)) * W;
			const y = (0.5 + 0.42 * Math.sin(t * b.fy + b.py)) * H;
			const g = sc.createRadialGradient(x, y, 0, x, y, b.rad * W);
			g.addColorStop(0, hsl(p.ink[b.c], 0.55 * k));
			g.addColorStop(1, hsl(p.ink[b.c], 0));
			sc.fillStyle = g;
			sc.fillRect(0, 0, W, H);
		}
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(small, 0, 0, w, h);
		return;
	}

	ctx.fillStyle = hsl(p.bg);
	ctx.fillRect(0, 0, w, h);

	if (s.kind === 'orbits') {
		const cx = s.cx * w;
		const cy = s.cy * h;
		const m = Math.max(w, h);
		const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.45);
		glow.addColorStop(0, hsl(p.ink[0], 0.28 * k));
		glow.addColorStop(1, hsl(p.ink[0], 0));
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, w, h);
		for (const ring of s.rings) {
			const r = ring.k * m;
			const a = ring.rot + (t * 0.25 * ring.dir) / (0.4 + ring.k * 3);
			const c = p.ink[ring.c];
			ctx.strokeStyle = hsl(c, 0.12 * k);
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
			ctx.stroke();
			ctx.strokeStyle = hsl(lighter(c, c.l + 0.12), 0.5 * k);
			ctx.lineWidth = ring.w * 1.4;
			ctx.beginPath();
			ctx.arc(cx, cy, r, a, a + ring.arc);
			ctx.stroke();
			if (ring.dot) {
				ctx.fillStyle = hsl(lighter(c, 0.7), 0.8 * k);
				ctx.beginPath();
				ctx.arc(
					cx + Math.cos(a + ring.arc) * r,
					cy + Math.sin(a + ring.arc) * r,
					2.4,
					0,
					Math.PI * 2
				);
				ctx.fill();
			}
		}
		return;
	}

	if (s.kind === 'waves') {
		for (const [i, line] of s.lines.entries()) {
			const y0 = line.y * h;
			const ph = line.ph + t * line.v;
			const path = new Path2D();
			for (let x = 0; x <= w; x += 6) {
				const u = x / w;
				const y =
					y0 +
					(Math.sin(u * line.f1 * 6.28 + ph) * line.a1 +
						Math.sin(u * line.f2 * 6.28 - ph * 1.3) * line.a2) *
						h;
				if (x === 0) path.moveTo(x, y);
				else path.lineTo(x, y);
			}
			if (i % 3 === 0) {
				const band = new Path2D(path);
				band.lineTo(w, h);
				band.lineTo(0, h);
				band.closePath();
				ctx.fillStyle = hsl(p.ink[line.c], 0.05 * k);
				ctx.fill(band);
			}
			ctx.strokeStyle = hsl(p.ink[line.c], 0.45 * k);
			ctx.lineWidth = 1.3;
			ctx.stroke(path);
		}
		return;
	}

	const pos = s.points.map((q) => ({
		...q,
		X: ((((q.x + q.vx * t) % 1) + 1) % 1) * w,
		Y: ((((q.y + q.vy * t) % 1) + 1) % 1) * h
	}));
	const near = Math.min(w, h) * 0.24;
	ctx.lineWidth = 1;
	for (let i = 0; i < pos.length; i++)
		for (let j = i + 1; j < pos.length; j++) {
			const d = Math.hypot(pos[i].X - pos[j].X, pos[i].Y - pos[j].Y);
			if (d > near) continue;
			ctx.strokeStyle = hsl(p.ink[pos[i].c], (1 - d / near) * 0.35 * k);
			ctx.beginPath();
			ctx.moveTo(pos[i].X, pos[i].Y);
			ctx.lineTo(pos[j].X, pos[j].Y);
			ctx.stroke();
		}
	for (const q of pos) {
		if (q.big) {
			const g = ctx.createRadialGradient(q.X, q.Y, 0, q.X, q.Y, 26);
			g.addColorStop(0, hsl(lighter(p.ink[q.c], 0.65), 0.45 * k));
			g.addColorStop(1, hsl(p.ink[q.c], 0));
			ctx.fillStyle = g;
			ctx.fillRect(q.X - 26, q.Y - 26, 52, 52);
		}
		ctx.fillStyle = hsl(lighter(p.ink[q.c], 0.72), 0.85 * k);
		ctx.beginPath();
		ctx.arc(q.X, q.Y, q.s, 0, Math.PI * 2);
		ctx.fill();
	}
}

/** Drift per second at `speed` from 0 to 1, as on the trial page. */
export const pace = (speed: number) => (0.15 + speed * 2.5) * 2;

/** Colours for the preview when nothing is playing: the reds of a Ghost in the Shell cover. */
export const SAMPLE_PALETTE: Palette = palette(
	['#5b190f', '#b93b27', '#7f241e', '#bb5932', '#cfa466', '#0f1a19'].map((hex) => {
		const n = parseInt(hex.slice(1), 16);
		return rgbToHsl(n >> 16, (n >> 8) & 255, n & 255);
	})
);

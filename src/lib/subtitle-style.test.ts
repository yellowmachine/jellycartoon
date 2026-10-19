import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_SUBTITLE_STYLE,
	mpvSubtitleProperties,
	sanitizeSubtitleStyle,
	SUBTITLE_PRESETS,
	subtitleCss
} from './subtitle-style.ts';

describe('sanitizeSubtitleStyle', () => {
	test('fills missing keys with defaults', () => {
		expect(sanitizeSubtitleStyle({ color: 'yellow' })).toEqual({
			...DEFAULT_SUBTITLE_STYLE,
			color: 'yellow'
		});
		expect(sanitizeSubtitleStyle(null)).toEqual(DEFAULT_SUBTITLE_STYLE);
	});

	test('drops unknown keys and values, so nothing can reach the stylesheet', () => {
		const style = sanitizeSubtitleStyle({
			color: 'red;}</style><script>alert(1)</script>',
			size: 'xl',
			extra: 'x'
		});
		expect(style).toEqual({ ...DEFAULT_SUBTITLE_STYLE, size: 'xl' });
		expect(Object.values(subtitleCss(style)).join()).not.toContain('<');
	});
});

test('a preset keeps where they go', () => {
	expect('position' in SUBTITLE_PRESETS[0]!.style).toBe(false);
	expect(subtitleCss({ ...DEFAULT_SUBTITLE_STYLE, position: 'raised' }).line).toBe('88');
	expect(subtitleCss(DEFAULT_SUBTITLE_STYLE).line).toBe('auto');
});

describe('mpvSubtitleProperties', () => {
	const props = (style: Partial<import('./subtitle-style.ts').SubtitleStyle>) =>
		Object.fromEntries(mpvSubtitleProperties({ ...DEFAULT_SUBTITLE_STYLE, ...style }));

	test('the original version look: yellow Liberation Sans in bold, thick outline, no box', () => {
		expect(props(SUBTITLE_PRESETS[0]!.style)).toEqual({
			'sub-font': 'Liberation Sans',
			'sub-bold': true,
			'sub-scale': 1,
			'sub-color': '#FFFFE14D',
			'sub-border-style': 'outline-and-shadow',
			'sub-back-color': '#E6000000',
			'sub-border-color': '#FF000000',
			'sub-border-size': 3.5,
			'sub-shadow-offset': 0,
			'sub-pos': 100
		});
	});

	test('a little higher: mpv sub-pos, where their bottom goes', () => {
		expect(props({ position: 'raised' })['sub-pos']).toBe(88);
		expect(props({ position: 'high' })['sub-pos']).toBe(80);
	});

	test('a box is mpv background-box, with the opacity as alpha first', () => {
		const solid = props({ background: 'solid', size: 'xl' });
		expect(solid['sub-border-style']).toBe('background-box');
		expect(solid['sub-back-color']).toBe('#D9000000');
		expect(solid['sub-scale']).toBe(1.5);
		expect(solid['sub-bold']).toBe(false);
	});
});

import { describe, expect, test } from 'bun:test';
import { DEFAULT_SUBTITLE_STYLE, sanitizeSubtitleStyle, subtitleCss } from './subtitle-style.ts';

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

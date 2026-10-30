import { describe, expect, test } from 'bun:test';
import { bestFirst, imageKind, manifestIcons, pageIcons } from './site-icon.ts';

/** A site's icon for the TV's tiles (#327): what its page and manifest declare, the biggest first. */
describe('site icon', () => {
	test('the page’s touch icons, the manifest and the big ones', () => {
		const html = `<head>
			<link rel="icon" href="/favicon.ico" sizes="32x32">
			<link rel="apple-touch-icon" href="/touch.png">
			<link rel='icon' type='image/png' sizes='192x192 512x512' href='https://cdn.example/big.png'>
			<link href="/site.webmanifest" rel="manifest">
		</head>`;
		const { manifest, icons } = pageIcons(html, 'https://www.example.com/es/');
		expect(manifest).toBe('https://www.example.com/site.webmanifest');
		expect(bestFirst(icons).map((i) => [i.url, i.size])).toEqual([
			['https://cdn.example/big.png', 512],
			['https://www.example.com/touch.png', 180]
		]);
	});

	test('a manifest’s icons, without the monochrome ones', () => {
		const icons = manifestIcons(
			{
				icons: [
					{ src: 'icons/256.png', sizes: '256x256' },
					{ src: 'icons/mono.png', sizes: '512x512', purpose: 'monochrome' },
					{ src: 42 }
				]
			},
			'https://www.example.com/app/manifest.json'
		);
		expect(icons).toEqual([{ url: 'https://www.example.com/app/icons/256.png', size: 256 }]);
		expect(manifestIcons('not an object', 'https://example.com/')).toEqual([]);
	});

	test('its kind by its bytes: no SVG nor anything else', () => {
		expect(imageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('png');
		expect(imageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
		const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
		expect(imageKind(webp)).toBe('webp');
		expect(imageKind(new TextEncoder().encode('<svg xmlns='))).toBeNull();
	});
});

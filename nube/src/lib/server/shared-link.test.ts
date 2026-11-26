import { expect, test } from 'bun:test';
import { appleId, feedLinkOf } from './shared-link.ts';

test('Apple Podcasts’ id, from its address only', () => {
	expect(appleId('https://podcasts.apple.com/es/podcast/la-escobilla/id1234567890?i=1')).toBe(
		'1234567890'
	);
	expect(appleId('https://example.com/id1234')).toBeNull();
	expect(appleId('no es')).toBeNull();
});

test('the feed a page links to, made whole; a page without one, none', async () => {
	const page = (head: string) => `<html><head>${head}</head><body>Hola</body></html>`;
	expect(
		await feedLinkOf(
			page(
				'<link rel="stylesheet" href="a.css"><link rel="alternate" type="application/rss+xml" href="/feed/podcast.xml">'
			),
			'https://www.ivoox.com/programa_1.html'
		)
	).toBe('https://www.ivoox.com/feed/podcast.xml');
	expect(
		await feedLinkOf(
			page('<link rel="alternate" hreflang="en" href="https://example.com/en">'),
			'https://example.com/'
		)
	).toBeNull();
});

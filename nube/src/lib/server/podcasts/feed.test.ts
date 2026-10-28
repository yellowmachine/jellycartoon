import { describe, expect, test } from 'bun:test';
import { parseDuration, parseFeed, plainText } from './feed.ts';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
	<title>Historia de España</title>
	<link>https://example.com</link>
	<itunes:author>Radio Ejemplo</itunes:author>
	<description><![CDATA[<p>Un programa <b>semanal</b> &amp; más.</p>]]></description>
	<itunes:image href="https://example.com/cover.jpg"/>
	<item>
		<title>Los Reyes Católicos</title>
		<guid isPermaLink="false">ep-1</guid>
		<pubDate>Mon, 05 Oct 2026 08:00:00 +0200</pubDate>
		<enclosure url="https://example.com/1.mp3" type="audio/mpeg" length="1"/>
		<itunes:duration>1:02:03</itunes:duration>
	</item>
	<item>
		<title>Felipe II</title>
		<pubDate>Mon, 12 Oct 2026 08:00:00 +0200</pubDate>
		<enclosure url="https://example.com/2.mp3" type="audio/mpeg" length="1"/>
		<itunes:duration>2700</itunes:duration>
		<itunes:image href="https://example.com/2.jpg"/>
	</item>
	<item><title>Sin audio</title></item>
</channel>
</rss>`;

describe('parseFeed', () => {
	const feed = parseFeed(FEED);

	test('the podcast', () => {
		expect(feed.title).toBe('Historia de España');
		expect(feed.author).toBe('Radio Ejemplo');
		expect(feed.description).toBe('Un programa semanal & más.');
		expect(feed.imageUrl).toBe('https://example.com/cover.jpg');
	});

	test('episodes with audio, the newest first', () => {
		expect(feed.episodes.map((e) => e.title)).toEqual(['Felipe II', 'Los Reyes Católicos']);
		expect(feed.episodes[0]).toMatchObject({
			guid: 'https://example.com/2.mp3',
			durationSec: 2700,
			imageUrl: 'https://example.com/2.jpg'
		});
		expect(feed.episodes[1]).toMatchObject({ guid: 'ep-1', durationSec: 3723 });
	});

	test('not a feed', () => {
		expect(() => parseFeed('<html><body>hola</body></html>')).toThrow();
		expect(() => parseFeed('no es xml')).toThrow();
	});
});

test('parseDuration', () => {
	expect(parseDuration('90')).toBe(90);
	expect(parseDuration('12:30')).toBe(750);
	expect(parseDuration('')).toBeNull();
	expect(parseDuration('una hora')).toBeNull();
});

test('plainText', () => {
	expect(plainText('<p>Uno</p><p>Dos <a href="x">enlace</a></p>')).toBe('Uno\nDos enlace');
	expect(plainText('a'.repeat(700))!.length).toBe(600);
});

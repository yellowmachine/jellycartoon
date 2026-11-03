import { describe, expect, test } from 'bun:test';
import { STATIONS } from 'comun/radio.ts';
import { MAX_HEADLINES, parseHeadlines } from './radio-news.ts';

/** A station's headlines (#387), from its broadcaster's RSS or Atom feed. */
describe('parseHeadlines', () => {
	test('RSS: titles (CDATA, entities), links and when, the newest first', () => {
		const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Noticias</title>
			<item><title><![CDATA[Uno &amp; dos]]></title><link>https://ejemplo.es/1</link>
				<pubDate>Tue, 03 Nov 2026 10:00:00 +0100</pubDate></item>
			<item><title>Más nuevo</title><link>https://ejemplo.es/2</link>
				<pubDate>Tue, 03 Nov 2026 12:00:00 +0100</pubDate></item>
			<item><title>Midterms : r&amp;#xE9;sultats &amp;#233;</title><link>https://ejemplo.fr/m</link></item>
			<item><title>Sin enlace web</title><link>javascript:alert(1)</link></item>
			<item><title></title><link>https://ejemplo.es/vacio</link></item>
		</channel></rss>`;
		expect(parseHeadlines(xml)).toEqual([
			{ title: 'Más nuevo', link: 'https://ejemplo.es/2', at: '2026-11-03T11:00:00.000Z' },
			{ title: 'Uno & dos', link: 'https://ejemplo.es/1', at: '2026-11-03T09:00:00.000Z' },
			{ title: 'Midterms : résultats é', link: 'https://ejemplo.fr/m', at: null }
		]);
	});

	test('Atom: the alternate link, and published or updated', () => {
		const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
			<entry><title>Atom</title><link rel="self" href="https://ejemplo.fr/self"/>
				<link rel="alternate" href="https://ejemplo.fr/a"/><updated>2026-11-03T08:00:00Z</updated></entry>
		</feed>`;
		expect(parseHeadlines(xml)).toEqual([
			{ title: 'Atom', link: 'https://ejemplo.fr/a', at: '2026-11-03T08:00:00.000Z' }
		]);
	});

	test('at most a few, and nothing from what is not a feed', () => {
		const items = Array.from(
			{ length: 40 },
			(_, i) => `<item><title>T${i}</title><link>https://e.es/${i}</link></item>`
		).join('');
		expect(parseHeadlines(`<rss><channel>${items}</channel></rss>`)).toHaveLength(MAX_HEADLINES);
		expect(parseHeadlines('<html><body>no</body></html>')).toEqual([]);
		expect(parseHeadlines('no es xml <<<')).toEqual([]);
	});

	test('the stations with a feed: talk ones, with a web address', () => {
		for (const s of STATIONS.filter((s) => s.feed)) {
			expect(s.kind).toBe('talk');
			expect(new URL(s.feed!).protocol).toBe('https:');
		}
	});
});

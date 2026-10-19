import { describe, expect, test } from 'bun:test';
import {
	crawlDelay,
	parseSitemap,
	searchWords,
	sitemapsInRobots,
	skipSitemap,
	slugTitle
} from './sitemap.ts';

test('sitemapsInRobots: every Sitemap line, in any case', () => {
	expect(
		sitemapsInRobots(
			'User-agent: *\nDisallow: /wp-admin/\nSitemap: https://ejemplo.es/sitemap_index.xml\nsitemap:https://ejemplo.es/recetas.xml\n'
		)
	).toEqual(['https://ejemplo.es/sitemap_index.xml', 'https://ejemplo.es/recetas.xml']);
	expect(sitemapsInRobots('User-agent: *')).toEqual([]);
});

describe('parseSitemap', () => {
	test('an index, with one sitemap or several', () => {
		const index = (body: string) =>
			parseSitemap(
				`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`
			);
		expect(index('<sitemap><loc>https://e.es/post-sitemap.xml</loc></sitemap>')).toEqual({
			sitemaps: [{ url: 'https://e.es/post-sitemap.xml', lastmod: null }],
			pages: []
		});
		expect(
			index(
				'<sitemap><loc> https://e.es/a.xml </loc><lastmod>2026-10-01</lastmod></sitemap><sitemap><loc>https://e.es/b.xml</loc></sitemap>'
			)?.sitemaps
		).toEqual([
			{ url: 'https://e.es/a.xml', lastmod: '2026-10-01' },
			{ url: 'https://e.es/b.xml', lastmod: null }
		]);
	});

	test('a urlset, with image tags in their own namespace', () => {
		expect(
			parseSitemap(
				'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>https://e.es/macarrones-gratinados/</loc><image:image><image:loc>https://e.es/m.jpg</image:loc></image:image></url></urlset>'
			)
		).toEqual({ sitemaps: [], pages: ['https://e.es/macarrones-gratinados/'] });
	});

	test('not a sitemap', () => {
		expect(parseSitemap('<html><body>404</body></html>')).toBeNull();
		expect(parseSitemap('no es xml <<<')).toBeNull();
	});
});

test('skipSitemap: images, categories, tags, authors and pages are not recipes', () => {
	for (const url of [
		'https://e.es/category-sitemap.xml',
		'https://e.es/post_tag-sitemap.xml',
		'https://e.es/author-sitemap.xml',
		'https://e.es/page-sitemap.xml',
		'https://e.es/wp-sitemap-taxonomies-category-1.xml',
		'https://e.es/sitemap-images.xml'
	])
		expect(skipSitemap(url)).toBe(true);
	for (const url of [
		'https://e.es/post-sitemap.xml',
		'https://e.es/wp-sitemap-posts-post-1.xml',
		'https://e.es/categoria/recetas-de-pasta/sitemap.xml',
		'https://e.es/archivos/2026/10/sitemap.xml'
	])
		expect(skipSitemap(url)).toBe(false);
});

test('crawlDelay: for us, else for every bot', () => {
	expect(crawlDelay('User-agent: *\nDisallow: /wp-admin/\nCrawl-delay: 5\n')).toBe(5);
	expect(
		crawlDelay(
			'User-agent: Googlebot\nCrawl-delay: 1\n\nUser-agent: JellyCartoon\nUser-agent: Otro\nCrawl-delay: 10 # lento\n\nUser-agent: *\nCrawl-delay: 3'
		)
	).toBe(10);
	expect(
		crawlDelay('User-agent: Googlebot\nCrawl-delay: 1\nUser-agent: *\nDisallow: /x')
	).toBeNull();
	expect(crawlDelay('')).toBeNull();
});

test('slugTitle: the words of the address', () => {
	expect(slugTitle('https://e.es/recetas-de-pasta/macarrones-gratinados-con-bechamel/')).toBe(
		'Macarrones gratinados con bechamel'
	);
	expect(slugTitle('https://e.es/comer/macarrones-gratinados-receta-ada_1_5842309.html')).toBe(
		'Macarrones gratinados receta ada'
	);
	expect(slugTitle('https://e.es/2008/11/27-macarrones-al-horno-receta')).toBe(
		'Macarrones al horno receta'
	);
	expect(slugTitle('https://e.es/receta/croquetas-de-jam%C3%B3n')).toBe('Croquetas de jamón');
	expect(slugTitle('https://e.es/?p=123')).toBeNull();
	expect(slugTitle('https://e.es/')).toBeNull();
});

test('searchWords: folded, without empty words, as roots', () => {
	expect(searchWords('Receta de Macarrones gratinados con Bechamel')).toEqual([
		'macarron',
		'gratinado',
		'bechamel'
	]);
	expect(searchWords('croquetas de jamón')).toEqual(['croqueta', 'jamon']);
	expect(searchWords('de la con')).toEqual([]);
});

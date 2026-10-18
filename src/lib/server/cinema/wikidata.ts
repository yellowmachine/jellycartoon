import { htmlToText } from './html-text.ts';

/**
 * Films and TV series in Wikidata and their Wikipedia articles, through the public APIs (no key
 * needed): https://www.wikidata.org/w/api.php and https://es.wikipedia.org/api/rest_v1/
 */

/** Wikimedia asks every client to identify itself: https://meta.wikimedia.org/wiki/User-Agent_policy */
const USER_AGENT = 'JellyCartoon/1.0 (https://github.com/yellowmachine/jellycartoon)';

/**
 * Films are tagged as "film", but also as "anime film", "comedy film"… Searching for items with a
 * director (P57) finds them all; TV series and episodes are dropped afterwards by their description.
 */
const SEARCH_FILTER = 'haswbstatement:P57';
const FILM_DESCRIPTION = /pel[ií]cula|film|movie|largometraje|cortometraje/i;

async function getJson(url: string, params: Record<string, string>) {
	const res = await fetch(`${url}?${new URLSearchParams(params)}`, {
		headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
		signal: AbortSignal.timeout(20_000)
	});
	if (!res.ok) throw new Error(`${new URL(url).hostname}: ${res.status} ${res.statusText}`);
	return res.json();
}

const wikidata = (params: Record<string, string>) =>
	getJson('https://www.wikidata.org/w/api.php', { format: 'json', ...params });

/** Ids of films whose label or aliases match `query`, best first. */
export async function searchFilms(query: string, limit = 8): Promise<string[]> {
	const body = await wikidata({
		action: 'query',
		list: 'search',
		srsearch: `${query} ${SEARCH_FILTER}`,
		srlimit: String(limit)
	});
	return (body.query?.search ?? []).map((r: { title: string }) => r.title);
}

interface Snak {
	mainsnak: { datavalue?: { value: unknown } };
	rank: string;
	/** E.g. the year of an award (P585), the place in a series (P1545). */
	qualifiers?: Record<string, { datavalue?: { value: unknown } }[]>;
}

export interface Entity {
	id: string;
	labels?: Record<string, { value: string }>;
	descriptions?: Record<string, { value: string }>;
	aliases?: Record<string, { value: string }[]>;
	claims?: Record<string, Snak[]>;
	sitelinks?: Record<string, { title: string }>;
}

async function getEntities(ids: string[], props: string): Promise<Entity[]> {
	const entities: Entity[] = [];
	// The API takes up to 50 ids per request.
	for (let i = 0; i < ids.length; i += 50) {
		const body = await wikidata({
			action: 'wbgetentities',
			ids: ids.slice(i, i + 50).join('|'),
			props,
			// `mul`: the label for every language, which some items have instead of an English one
			// (https://www.wikidata.org/wiki/Help:Default_values_for_labels_and_aliases).
			languages: 'es|en|mul',
			sitefilter: 'eswiki|enwiki'
		});
		entities.push(...Object.values(body.entities as Record<string, Entity>));
	}
	return entities;
}

const text = (map: Record<string, { value: string }> | undefined) =>
	map?.es?.value ?? map?.en?.value ?? map?.mul?.value ?? null;

function values(entity: Entity, property: string) {
	return (entity.claims?.[property] ?? [])
		.filter((s) => s.rank !== 'deprecated' && s.mainsnak.datavalue)
		.map((s) => s.mainsnak.datavalue!.value);
}

const itemIds = (entity: Entity, property: string) =>
	values(entity, property).map((v) => (v as { id: string }).id);

/** Earliest publication year: the premiere, not later re-releases. */
function year(entity: Entity) {
	const years = values(entity, 'P577')
		.map((v) => Number((v as { time: string }).time.match(/^[+-](\d{4})/)?.[1]))
		.filter(Boolean);
	return years.length ? Math.min(...years) : null;
}

/** Runtime in minutes (P2047 is given in minutes, sometimes in seconds or hours). */
function minutes(entity: Entity) {
	const [duration] = values(entity, 'P2047') as { amount: string; unit: string }[];
	if (!duration) return null;
	const amount = Number(duration.amount);
	if (duration.unit.endsWith('/Q11574')) return Math.round(amount / 60);
	if (duration.unit.endsWith('/Q25235')) return Math.round(amount * 60);
	return Math.round(amount);
}

export interface Candidate {
	id: string;
	title: string;
	/** Other names it is known by, to compare with the file's. */
	names: string[];
	description: string | null;
	year: number | null;
	minutes: number | null;
	directors: string[];
}

/** The candidates with what is needed to tell them apart: year, runtime and director. */
export async function describeCandidates(ids: string[]): Promise<Candidate[]> {
	if (!ids.length) return [];
	const entities = await getEntities(ids, 'labels|descriptions|aliases|claims');
	const directorIds = [...new Set(entities.flatMap((e) => itemIds(e, 'P57')))];
	const directors = await labels(directorIds);
	const byId = new Map(entities.map((e) => [e.id, e]));
	return ids
		.map((id) => byId.get(id))
		.filter((e): e is Entity => Boolean(e?.labels))
		.filter((e) => FILM_DESCRIPTION.test(text(e.descriptions) ?? ''))
		.map((e) => ({
			id: e.id,
			title: text(e.labels) ?? e.id,
			names: [
				...Object.values(e.labels ?? {}).map((l) => l.value),
				...Object.values(e.aliases ?? {}).flatMap((a) => a.map((l) => l.value)),
				...values(e, 'P1476').map((v) => (v as { text: string }).text)
			],
			description: text(e.descriptions),
			year: year(e),
			minutes: minutes(e),
			directors: [
				...new Set(
					itemIds(e, 'P57')
						.map((id) => directors.get(id))
						.filter((name): name is string => Boolean(name))
				)
			]
		}));
}

async function labels(ids: string[]) {
	const entities = await getEntities(ids, 'labels');
	return new Map(entities.map((e) => [e.id, text(e.labels) ?? e.id]));
}

/** Black-and-white (a value of P462, color), and silent film (a genre, or what it is). */
const BLACK_AND_WHITE = 'Q838368';
const SILENT_FILM = 'Q226730';

/**
 * The details the second set of Cine filters needs, as Wikidata ids still to be named: awards
 * won (P166) and nominations (P1411) with their year (P585), the series it is part of (P179) with
 * its place (P1545), screenwriters (P58), composers (P86), cinematographers (P344), and whether it
 * is black and white or silent. Pure, from the entity.
 */
export function rawFilmExtras(entity: Entity) {
	const statements = (property: string) =>
		(entity.claims?.[property] ?? []).filter(
			(s) => s.rank !== 'deprecated' && s.mainsnak.datavalue
		);
	const qualifier = (s: Snak, property: string) => s.qualifiers?.[property]?.[0]?.datavalue?.value;
	const yearOf = (s: Snak) => {
		const time = (qualifier(s, 'P585') as { time?: string } | undefined)?.time;
		return Number(time?.match(/^[+-](\d{4})/)?.[1]) || null;
	};
	const awards = (property: string, won: boolean) =>
		statements(property).map((s) => ({
			id: (s.mainsnak.datavalue!.value as { id: string }).id,
			year: yearOf(s),
			won
		}));
	return {
		awards: [...awards('P166', true), ...awards('P1411', false)],
		sagas: statements('P179').map((s) => ({
			id: (s.mainsnak.datavalue!.value as { id: string }).id,
			order: Number(qualifier(s, 'P1545')) || null
		})),
		writers: itemIds(entity, 'P58'),
		composers: itemIds(entity, 'P86'),
		cinematographers: itemIds(entity, 'P344'),
		blackAndWhite: itemIds(entity, 'P462').includes(BLACK_AND_WHITE),
		silent: [...itemIds(entity, 'P136'), ...itemIds(entity, 'P31')].includes(SILENT_FILM)
	};
}

type RawExtras = ReturnType<typeof rawFilmExtras>;

/** Every id the extras need named. */
const extrasIds = (raw: RawExtras) => [
	...raw.awards.map((a) => a.id),
	...raw.sagas.map((s) => s.id),
	...raw.writers,
	...raw.composers,
	...raw.cinematographers
];

export type FilmExtras = {
	awards: { name: string; year: number | null; won: boolean }[];
	sagas: { name: string; order: number | null }[];
	writers: string[];
	composers: string[];
	cinematographers: string[];
	blackAndWhite: boolean;
	silent: boolean;
};

/**
 * A label as it should read: some carry a Wikipedia page's prefix («Anexo:Premio Annie…») or
 * start in lower case («premio Hugo»).
 */
export function cleanLabel(label: string) {
	const text = label.replace(/^(Anexo|List of|Lista de):\s*/i, '').trim();
	return text.charAt(0).toLocaleUpperCase('es') + text.slice(1);
}

/** «Part of the series» is also used for rankings and lists: those are no saga. */
const NOT_A_SAGA = /^(lista|list|anexo|ranking)\b|\b(mejores|best|greatest|top \d+)\b/i;

/** The extras with names instead of ids; an award won is not also listed as a nomination. */
export function nameFilmExtras(raw: RawExtras, names: Map<string, string>): FilmExtras {
	const name = (id: string) => {
		const label = names.get(id);
		return label ? cleanLabel(label) : null;
	};
	const people = (ids: string[]) => [
		...new Set(ids.map(name).filter((n): n is string => Boolean(n)))
	];
	const won = new Set(raw.awards.filter((a) => a.won).map((a) => a.id));
	const seen = new Set<string>();
	return {
		awards: raw.awards.flatMap((a) => {
			const key = `${a.id}:${a.won}`;
			const label = name(a.id);
			if (!label || seen.has(key) || (!a.won && won.has(a.id))) return [];
			seen.add(key);
			return [{ name: label, year: a.year, won: a.won }];
		}),
		sagas: raw.sagas.flatMap((s) => {
			const label = name(s.id);
			return label && !NOT_A_SAGA.test(label) ? [{ name: label, order: s.order }] : [];
		}),
		writers: people(raw.writers),
		composers: people(raw.composers),
		cinematographers: people(raw.cinematographers),
		blackAndWhite: raw.blackAndWhite,
		silent: raw.silent
	};
}

/**
 * The extras of several films at once, by their Wikidata ids: up to 50 per request, for those
 * looked up before the extras existed.
 */
export async function filmsExtras(ids: string[]): Promise<Map<string, FilmExtras>> {
	const entities = await getEntities(ids, 'claims');
	const raws = new Map(entities.map((e) => [e.id, rawFilmExtras(e)]));
	const names = await labels([...new Set([...raws.values()].flatMap(extrasIds))]);
	return new Map([...raws].map(([id, raw]) => [id, nameFilmExtras(raw, names)]));
}

export interface FilmDetails extends FilmExtras {
	wikidataId: string;
	title: string;
	originalTitle: string | null;
	year: number | null;
	minutes: number | null;
	directors: string[];
	cast: string[];
	genres: string[];
	countries: string[];
	imdbId: string | null;
	synopsis: string | null;
	wikipediaUrl: string | null;
}

/** Everything the film page shows, from Wikidata and the Spanish (or else English) Wikipedia. */
export async function filmDetails(id: string): Promise<FilmDetails> {
	const [entity] = await getEntities([id], 'labels|claims|sitelinks');
	if (!entity?.labels) throw new Error(`${id} no existe en Wikidata`);

	const castIds = itemIds(entity, 'P161').slice(0, 8);
	const extras = rawFilmExtras(entity);
	const names = await labels([
		...new Set([
			...itemIds(entity, 'P57'),
			...castIds,
			...itemIds(entity, 'P136'),
			...itemIds(entity, 'P495'),
			...extrasIds(extras)
		])
	]);
	// The same person can be listed twice (e.g. with different qualifiers).
	const named = (ids: string[]) => [
		...new Set(ids.map((i) => names.get(i)).filter((n): n is string => !!n))
	];

	const article = entity.sitelinks?.eswiki
		? { lang: 'es', title: entity.sitelinks.eswiki.title }
		: entity.sitelinks?.enwiki
			? { lang: 'en', title: entity.sitelinks.enwiki.title }
			: null;
	const summary = article ? await wikipediaSummary(article.lang, article.title) : null;

	return {
		wikidataId: id,
		title: text(entity.labels) ?? id,
		originalTitle: (values(entity, 'P1476')[0] as { text: string } | undefined)?.text ?? null,
		year: year(entity),
		minutes: minutes(entity),
		directors: named(itemIds(entity, 'P57')),
		cast: named(castIds),
		genres: named(itemIds(entity, 'P136')),
		countries: named(itemIds(entity, 'P495')),
		imdbId: (values(entity, 'P345')[0] as string | undefined) ?? null,
		synopsis: summary?.extract ?? null,
		wikipediaUrl: summary?.url ?? null,
		...nameFilmExtras(extras, names)
	};
}

async function wikipediaSummary(lang: string, title: string) {
	const res = await fetch(
		`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(' ', '_'))}`,
		{ headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) }
	);
	if (!res.ok) return null;
	const body = await res.json();
	return {
		extract: (body.extract as string | undefined) ?? null,
		url: (body.content_urls?.desktop?.page as string | undefined) ?? null
	};
}

/** Enough for the history and the making of a film, without sending a whole book with each question. */
const ARTICLE_CHARS = 25_000;

export interface Article {
	lang: 'es' | 'en';
	title: string;
	text: string;
}

/** The film's whole articles in the Spanish and English Wikipedias, as plain text. */
export async function filmArticles(id: string): Promise<Article[]> {
	const [entity] = await getEntities([id], 'sitelinks');
	const links = (['es', 'en'] as const)
		.map((lang) => ({ lang, title: entity?.sitelinks?.[`${lang}wiki`]?.title }))
		.filter((l): l is { lang: 'es' | 'en'; title: string } => !!l.title);
	const articles = await Promise.all(
		links.map(async ({ lang, title }): Promise<Article | null> => {
			// https://www.mediawiki.org/wiki/Extension:TextExtracts
			const body = await getJson(`https://${lang}.wikipedia.org/w/api.php`, {
				action: 'query',
				prop: 'extracts',
				explaintext: '1',
				redirects: '1',
				titles: title,
				format: 'json',
				formatversion: '2'
			});
			const text = (body.query?.pages?.[0]?.extract as string | undefined)?.trim();
			return text ? { lang, title, text: text.slice(0, ARTICLE_CHARS) } : null;
		})
	);
	return articles.filter((a): a is Article => a !== null);
}

/**
 * TV series, animated series, anime, miniseries, web series, sitcoms and film series (the cartoon
 * shorts of the cinemas, like Tom and Jerry's). Several values are an OR:
 * https://www.mediawiki.org/wiki/Help:Extension:WikibaseCirrusSearch#haswbstatement
 */
const SERIES_FILTER =
	'haswbstatement:' +
	[
		'Q5398426',
		'Q581714',
		'Q117467246',
		'Q63952888',
		'Q1259759',
		'Q15416',
		'Q526877',
		'Q170238',
		'Q24856'
	]
		.map((type) => `P31=${type}`)
		.join('|');

/** Ids of series whose label or aliases match `query`, best first. */
export async function searchSeries(query: string, limit = 10): Promise<string[]> {
	const body = await wikidata({
		action: 'query',
		list: 'search',
		srsearch: `${query} ${SERIES_FILTER}`,
		srlimit: String(limit)
	});
	return (body.query?.search ?? []).map((r: { title: string }) => r.title);
}

/** When it started: the year of its first broadcast (P580), or else of its publication. */
function startYear(entity: Entity) {
	const [start] = values(entity, 'P580') as { time: string }[];
	return Number(start?.time.match(/^[+-](\d{4})/)?.[1]) || year(entity);
}

function count(entity: Entity, property: string) {
	const [amount] = values(entity, property) as { amount: string }[];
	return amount ? Number(amount.amount) : null;
}

/** The series as candidates: with their names, start year and description to tell them apart. */
export async function describeSeries(ids: string[]): Promise<Candidate[]> {
	if (!ids.length) return [];
	const entities = await getEntities(ids, 'labels|descriptions|aliases|claims');
	const byId = new Map(entities.map((e) => [e.id, e]));
	return ids
		.map((id) => byId.get(id))
		.filter((e): e is Entity => Boolean(e && text(e.labels)))
		.map((e) => ({
			id: e.id,
			title: text(e.labels)!,
			names: [
				...Object.values(e.labels ?? {}).map((l) => l.value),
				...Object.values(e.aliases ?? {}).flatMap((a) => a.map((l) => l.value)),
				...values(e, 'P1476').map((v) => (v as { text: string }).text)
			],
			description: text(e.descriptions),
			year: startYear(e),
			minutes: null,
			directors: []
		}));
}

export interface WikiPage {
	lang: 'es' | 'en';
	title: string;
}

export interface SeriesDetails {
	wikidataId: string;
	title: string;
	originalTitle: string | null;
	startYear: number | null;
	endYear: number | null;
	seasons: number | null;
	episodes: number | null;
	synopsis: string | null;
	wikipediaUrl: string | null;
	/**
	 * Where its episodes are listed, in Spanish and in English: the list of episodes (P1811) if it
	 * has its own article (`Anexo:Episodios de…`, `List of … episodes`), or else the series' article.
	 */
	episodePages: WikiPage[];
}

/** What the series page shows, and where to find its episodes. */
export async function seriesDetails(id: string): Promise<SeriesDetails> {
	const [entity] = await getEntities([id], 'labels|claims|sitelinks');
	if (!entity || !text(entity.labels)) throw new Error(`${id} no existe en Wikidata`);
	const [listId] = itemIds(entity, 'P1811');
	const [list] = listId ? await getEntities([listId], 'sitelinks') : [];

	const article = (['es', 'en'] as const)
		.map((lang) => ({ lang, title: entity.sitelinks?.[`${lang}wiki`]?.title }))
		.find((a): a is WikiPage => !!a.title);
	const summary = article ? await wikipediaSummary(article.lang, article.title) : null;
	const [end] = values(entity, 'P582') as { time: string }[];

	return {
		wikidataId: id,
		title: text(entity.labels)!,
		originalTitle: (values(entity, 'P1476')[0] as { text: string } | undefined)?.text ?? null,
		startYear: startYear(entity),
		endYear: Number(end?.time.match(/^[+-](\d{4})/)?.[1]) || null,
		seasons: count(entity, 'P2437'),
		episodes: count(entity, 'P1113'),
		synopsis: summary?.extract ?? null,
		wikipediaUrl: summary?.url ?? null,
		episodePages: (['es', 'en'] as const)
			.map((lang) => ({
				lang,
				title: list?.sitelinks?.[`${lang}wiki`]?.title ?? entity.sitelinks?.[`${lang}wiki`]?.title
			}))
			.filter((p): p is WikiPage => !!p.title)
	};
}

/**
 * An article as plain text, tables included (the episodes are in tables, which TextExtracts drops),
 * from its rendered HTML: https://www.mediawiki.org/wiki/API:Parsing_wikitext
 */
export async function wikipediaPageText(page: WikiPage) {
	const body = await getJson(`https://${page.lang}.wikipedia.org/w/api.php`, {
		action: 'parse',
		page: page.title,
		prop: 'text',
		redirects: '1',
		disablelimitreport: '1',
		disableeditsection: '1',
		format: 'json',
		formatversion: '2'
	});
	const html = body.parse?.text as string | undefined;
	if (!html) throw new Error(`No se pudo leer «${page.title}» de Wikipedia (${page.lang})`);
	return htmlToText(html);
}

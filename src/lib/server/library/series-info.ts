import { asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, series, seriesInfo } from '#lib/server/db/schema.ts';
import { openRouterConfig } from '#lib/server/app-settings.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { log } from '#lib/server/log.ts';
import { pick, queries, type Clues } from '#lib/server/cinema/match.ts';
import { describeSeries, searchSeries, seriesDetails } from '#lib/server/cinema/wikidata.ts';

export type SeriesInfo = typeof seriesInfo.$inferSelect;

/** Lookups in progress, so opening the page twice does not look the series up twice. */
const running = new Map<number, Promise<SeriesInfo>>();

export async function savedSeriesInfo(seriesId: number) {
	const [saved] = await db.select().from(seriesInfo).where(eq(seriesInfo.seriesId, seriesId));
	return saved ?? null;
}

/** Looks the series up, unless that is already being done (e.g. the page was opened twice). */
export function lookUpSeries(seriesId: number) {
	let lookup = running.get(seriesId);
	if (!lookup) {
		lookup = identifySeries(seriesId).finally(() => running.delete(seriesId));
		running.set(seriesId, lookup);
	}
	return lookup;
}

/** Enough file names to recognise the series, from all over it. */
const SAMPLE_FILES = 12;

/**
 * Looks the series up: the AI (with a key) says which series the folder is, then Wikidata gives the
 * facts. `title`: searched instead of the series', when the user types one.
 */
export async function identifySeries(seriesId: number, title?: string): Promise<SeriesInfo> {
	const [s] = await db
		.select({ title: series.title, folder: series.folder })
		.from(series)
		.where(eq(series.id, seriesId));
	if (!s) throw new Error('Serie no encontrada');
	const known: Clues = { title: title ?? s.title, year: null, minutes: null };
	// A title typed by hand is all there is to go on.
	if (!title) known.hint = (await aiGuess(seriesId, s)) ?? undefined;

	const ids = [...new Set((await Promise.all(queries(known).map((q) => searchSeries(q)))).flat())];
	const { match, ranked } = pick(await describeSeries(ids), known);
	log.info(
		'series',
		`Ficha de la serie «${known.title}»: ${match ? `${match.title} (${match.year})` : ranked.length ? `${ranked.length} candidatas` : 'no encontrada'}`,
		{ seriesId, hint: known.hint, candidates: ranked.map((c) => c.id) }
	);

	if (match) return chooseSeries(seriesId, match.id);
	return save(seriesId, {
		status: ranked.length ? 'ambiguous' : 'not_found',
		candidates: ranked.map(({ id, title, year, description }) => ({ id, title, year, description }))
	});
}

/** The series is this Wikidata item: its details, saved. */
export async function chooseSeries(seriesId: number, wikidataId: string): Promise<SeriesInfo> {
	const details = await seriesDetails(wikidataId);
	return save(seriesId, { status: 'found', ...details, candidates: [] });
}

/** Forgets it: the next visit looks it up again. */
export async function forgetSeries(seriesId: number) {
	await db.delete(seriesInfo).where(eq(seriesInfo.seriesId, seriesId));
}

async function save(seriesId: number, values: Omit<typeof seriesInfo.$inferInsert, 'seriesId'>) {
	const row = { ...values, updatedAt: new Date() };
	const [saved] = await db
		.insert(seriesInfo)
		.values({ seriesId, ...row })
		// Every column, so a new lookup does not keep anything from the previous one.
		.onConflictDoUpdate({
			target: seriesInfo.seriesId,
			set: {
				wikidataId: null,
				title: null,
				originalTitle: null,
				startYear: null,
				endYear: null,
				seasons: null,
				episodes: null,
				synopsis: null,
				wikipediaUrl: null,
				episodePages: [],
				candidates: [],
				// Made from the previous series' episode list.
				titleProposal: null,
				...row
			}
		})
		.returning();
	return saved;
}

/** Without a key, or if it fails, the lookup goes on with the series' title. */
async function aiGuess(seriesId: number, s: { title: string; folder: string }) {
	if (!(await openRouterConfig()).apiKey) return null;
	const paths = (
		await db
			.select({ path: episode.sourcePath })
			.from(episode)
			.where(eq(episode.seriesId, seriesId))
			.orderBy(asc(episode.season), asc(episode.number))
	).map((e) => e.path);
	const step = Math.max(1, paths.length / SAMPLE_FILES);
	const sample = [
		...new Set(Array.from({ length: SAMPLE_FILES }, (_, i) => paths[Math.floor(i * step)]))
	].filter(Boolean);
	try {
		const guess = await completeJson<{
			known: boolean;
			originalTitle: string;
			spanishTitle: string | null;
			year: number | null;
		}>({
			system:
				'Eres un experto en series de televisión y dibujos animados. Identificas series a partir de la carpeta de una colección doméstica española y de los nombres de algunos de sus ficheros. ' +
				'Los nombres pueden estar en español o en el idioma original, abreviados, con erratas, con restos del programa que copió el disco (_t00, Disc 1) o de YouTube ([id], nombre del canal). ' +
				'Si no reconoces la serie con seguridad, responde known=false: es mejor no saberlo que inventarlo.',
			prompt: [
				`Carpeta: ${s.folder}`,
				`Título en el catálogo: ${s.title}`,
				'Algunos ficheros:',
				...sample.map((p) => `- ${p}`),
				'¿Qué serie es? Da su título original, su título en España y el año en que empezó.'
			].join('\n'),
			name: 'series',
			schema: {
				type: 'object',
				properties: {
					known: { type: 'boolean' },
					originalTitle: { type: 'string' },
					spanishTitle: { type: ['string', 'null'] },
					year: { type: ['integer', 'null'] }
				},
				required: ['known', 'originalTitle', 'spanishTitle', 'year'],
				additionalProperties: false
			}
		});
		if (!guess.known || !guess.originalTitle.trim()) return null;
		const { originalTitle, spanishTitle, year } = guess;
		return { originalTitle, spanishTitle, year, director: null };
	} catch (error) {
		log.warn('series', `La IA no pudo identificar la serie «${s.title}»`, { error });
		return null;
	}
}

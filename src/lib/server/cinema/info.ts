import { and, asc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { movie, movieInfo, movieTitle } from '#lib/server/db/schema.ts';
import { openRouterConfig } from '#lib/server/app-settings.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { log } from '#lib/server/log.ts';
import { pick, queries, type Clues } from './match.ts';
import { describeCandidates, filmDetails, filmsExtras, searchFilms } from './wikidata.ts';

/**
 * What a film's info has from Wikidata: 1, awards, sagas, screenwriters, composers,
 * cinematographers and black and white or silent. Info saved with an older one gets them read
 * again in the background (`wakeExtras`), by its Wikidata id.
 */
export const FILM_DETAILS_VERSION = 1;

export type MovieInfo = typeof movieInfo.$inferSelect;

/** Lookups in progress, so opening the page twice does not look the film up twice. */
const running = new Map<number, Promise<MovieInfo>>();

export async function savedMovieInfo(movieId: number) {
	const [saved] = await db.select().from(movieInfo).where(eq(movieInfo.movieId, movieId));
	return saved ?? null;
}

/** Looks the film up, unless that is already being done (e.g. the page was opened twice). */
export function lookUp(movieId: number) {
	let lookup = running.get(movieId);
	if (!lookup) {
		lookup = identify(movieId).finally(() => running.delete(movieId));
		running.set(movieId, lookup);
	}
	return lookup;
}

const PAUSE_MS = 3000;
let filling: Promise<void> | null = null;

/**
 * Looks up the films that have no info yet, one at a time and with a pause between them, so that
 * they can be searched by director or actor without opening each one first. After each scan.
 */
export function wakeInfo() {
	filling ??= fillPending()
		.catch((error) => log.error('cine', 'Fallo inesperado al buscar las fichas', { error }))
		.finally(() => (filling = null));
}

async function fillPending() {
	// Lookups that failed (e.g. Wikidata was down) are tried again on the next scan.
	const failed = new Set<number>();
	for (;;) {
		const pending = await db
			.select({ id: movie.id, path: movie.path })
			.from(movie)
			.leftJoin(movieInfo, eq(movieInfo.movieId, movie.id))
			// Catalogued first: the runtime helps to tell films apart.
			.where(and(eq(movie.status, 'ready'), eq(movie.missing, false), isNull(movieInfo.movieId)))
			.orderBy(asc(movie.id));
		const next = pending.find((m) => !failed.has(m.id));
		if (!next) return;
		try {
			await lookUp(next.id);
		} catch (error) {
			failed.add(next.id);
			log.warn('cine', `No se pudo buscar la ficha de ${next.path}`, { movieId: next.id, error });
		}
		await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
	}
}

/** Wikidata's API takes up to 50 items per request. */
const EXTRAS_BATCH = 50;

/** How the background reading of the extras goes, for Cine to say it. */
export const extrasProgress = { done: 0, total: 0 };
let extrasRun: Promise<void> | null = null;

/**
 * The extras (awards, sagas…) of the films found before they existed: by their Wikidata id, so
 * nothing is identified again, in batches of 50 with a pause between them. At the server's start;
 * films found later already get them.
 */
export function wakeExtras() {
	extrasRun ??= fillExtras()
		.catch((error) => log.error('cine', 'Fallo al completar las fichas', { error }))
		.finally(() => {
			extrasRun = null;
			Object.assign(extrasProgress, { done: 0, total: 0 });
		});
	return extrasRun;
}

async function fillExtras() {
	const stale = await db
		.select({ movieId: movieInfo.movieId, wikidataId: movieInfo.wikidataId })
		.from(movieInfo)
		.where(
			and(
				eq(movieInfo.status, 'found'),
				isNotNull(movieInfo.wikidataId),
				lt(movieInfo.detailsVersion, FILM_DETAILS_VERSION)
			)
		)
		.orderBy(asc(movieInfo.movieId));
	if (!stale.length) return;
	Object.assign(extrasProgress, { done: 0, total: stale.length });
	log.info('cine', `Completando ${stale.length} fichas con premios, sagas y más`);
	for (let i = 0; i < stale.length; i += EXTRAS_BATCH) {
		const batch = stale.slice(i, i + EXTRAS_BATCH);
		const extras = await filmsExtras(batch.map((b) => b.wikidataId!));
		for (const film of batch) {
			const found = extras.get(film.wikidataId!);
			// Not in the answer (the item was deleted or merged): tried again at the next start.
			if (!found) continue;
			await db
				.update(movieInfo)
				.set({ ...found, detailsVersion: FILM_DETAILS_VERSION })
				.where(eq(movieInfo.movieId, film.movieId));
		}
		extrasProgress.done = Math.min(i + EXTRAS_BATCH, stale.length);
		if (i + EXTRAS_BATCH < stale.length) await new Promise((r) => setTimeout(r, PAUSE_MS));
	}
	log.info('cine', `Fichas completadas: ${stale.length}`);
}

async function clues(
	movieId: number,
	title?: string
): Promise<Clues & { path: string; audio: string }> {
	const [film] = await db
		.select({
			title: movieTitle,
			year: movie.year,
			path: movie.path,
			durationSec: movie.durationSec,
			audioTracks: movie.audioTracks
		})
		.from(movie)
		.where(eq(movie.id, movieId));
	if (!film) throw new Error('Película no encontrada');
	return {
		title: title ?? film.title,
		// A title typed by hand is all there is to go on.
		year: title ? null : film.year,
		minutes: film.durationSec ? Math.round(film.durationSec / 60) : null,
		path: film.path,
		audio: film.audioTracks.map((t) => t.label).join(', ')
	};
}

/**
 * Looks the film up: the AI (with a key) says which film the file is, then Wikidata gives the
 * facts. `title`: searched instead of the catalogue's, when the user types one.
 */
export async function identify(movieId: number, title?: string): Promise<MovieInfo> {
	const known = await clues(movieId, title);
	if (!title) known.hint = (await aiGuess(known)) ?? undefined;

	const ids = [...new Set((await Promise.all(queries(known).map((q) => searchFilms(q)))).flat())];
	const { match, ranked } = pick(await describeCandidates(ids), known);
	log.info(
		'cine',
		`Ficha de «${known.title}»: ${match ? `${match.title} (${match.year})` : ranked.length ? `${ranked.length} candidatas` : 'no encontrada'}`,
		{ movieId, hint: known.hint, candidates: ranked.map((c) => c.id) }
	);

	if (match) return choose(movieId, match.id);
	return save(movieId, {
		status: ranked.length ? 'ambiguous' : 'not_found',
		candidates: ranked.map(({ id, title, year, directors, description }) => ({
			id,
			title,
			year,
			directors,
			description
		}))
	});
}

/** The film is this Wikidata item: its details, saved. */
export async function choose(movieId: number, wikidataId: string): Promise<MovieInfo> {
	const details = await filmDetails(wikidataId);
	let synopsis = details.synopsis;
	let synopsisSource: 'wikipedia' | 'ai' | null = synopsis ? 'wikipedia' : null;
	if (!synopsis) {
		synopsis = await aiSynopsis(details);
		if (synopsis) synopsisSource = 'ai';
	}
	return save(movieId, {
		status: 'found',
		...details,
		synopsis,
		synopsisSource,
		candidates: [],
		detailsVersion: FILM_DETAILS_VERSION
	});
}

/** Forgets it: the next visit looks it up again. */
export async function forget(movieId: number) {
	await db.delete(movieInfo).where(eq(movieInfo.movieId, movieId));
}

async function save(movieId: number, values: Omit<typeof movieInfo.$inferInsert, 'movieId'>) {
	const row = { ...values, updatedAt: new Date() };
	const [saved] = await db
		.insert(movieInfo)
		.values({ movieId, ...row })
		// Every column, so a new lookup does not keep anything from the previous one.
		.onConflictDoUpdate({
			target: movieInfo.movieId,
			set: {
				wikidataId: null,
				title: null,
				originalTitle: null,
				year: null,
				minutes: null,
				directors: [],
				cast: [],
				genres: [],
				countries: [],
				imdbId: null,
				synopsis: null,
				synopsisSource: null,
				wikipediaUrl: null,
				candidates: [],
				scenes: null,
				awards: [],
				sagas: [],
				writers: [],
				composers: [],
				cinematographers: [],
				blackAndWhite: false,
				silent: false,
				detailsVersion: 0,
				...row
			}
		})
		.returning();
	return saved;
}

/** Without a key, or if it fails, the lookup goes on with what the file says. */
async function aiGuess(known: Clues & { path: string; audio: string }) {
	if (!(await openRouterConfig()).apiKey) return null;
	try {
		const guess = await completeJson<{
			known: boolean;
			originalTitle: string;
			spanishTitle: string | null;
			year: number | null;
			director: string | null;
		}>({
			system:
				'Eres un experto en cine. Identificas películas a partir del nombre de un fichero de vídeo de una colección doméstica española. ' +
				'Los nombres pueden estar en español o en el idioma original, abreviados, con erratas o con restos del programa que copió el disco (_t00, T01, Disc 1). ' +
				'Si no reconoces la película con seguridad, responde known=false: es mejor no saberlo que inventarlo.',
			prompt: [
				`Fichero: ${known.path}`,
				`Título en el catálogo: ${known.title}`,
				known.year ? `Año en el nombre: ${known.year}` : null,
				known.minutes ? `Duración del fichero: ${known.minutes} minutos` : null,
				known.audio ? `Pistas de audio: ${known.audio}` : null,
				'¿Qué película es? Da su título original, su título en España, el año de estreno y el director.'
			]
				.filter(Boolean)
				.join('\n'),
			name: 'film',
			label: `Identificar «${known.title}»`,
			details: { path: known.path },
			schema: {
				type: 'object',
				properties: {
					known: { type: 'boolean' },
					originalTitle: { type: 'string' },
					spanishTitle: { type: ['string', 'null'] },
					year: { type: ['integer', 'null'] },
					director: { type: ['string', 'null'] }
				},
				required: ['known', 'originalTitle', 'spanishTitle', 'year', 'director'],
				additionalProperties: false
			}
		});
		if (!guess.known || !guess.originalTitle.trim()) return null;
		const { originalTitle, spanishTitle, year, director } = guess;
		return { originalTitle, spanishTitle, year, director };
	} catch (error) {
		log.warn('cine', `La IA no pudo identificar «${known.title}»`, { error });
		return null;
	}
}

/** Only when Wikipedia has no article: a short synopsis, shown as written by the AI. */
async function aiSynopsis(details: {
	title: string;
	originalTitle: string | null;
	year: number | null;
	directors: string[];
}) {
	if (!(await openRouterConfig()).apiKey) return null;
	try {
		const { synopsis } = await completeJson<{ synopsis: string }>({
			system:
				'Eres un experto en cine. Escribes sinopsis breves en español, sin desvelar el final. Si no conoces la película, devuelve una cadena vacía.',
			prompt: `Sinopsis de dos o tres frases de «${details.originalTitle ?? details.title}» (${[details.year, details.directors.join(', ')].filter(Boolean).join(', ')}).`,
			name: 'synopsis',
			label: `Sinopsis de «${details.title}»`,
			schema: {
				type: 'object',
				properties: { synopsis: { type: 'string' } },
				required: ['synopsis'],
				additionalProperties: false
			}
		});
		return synopsis.trim() || null;
	} catch (error) {
		log.warn('cine', `La IA no pudo escribir la sinopsis de «${details.title}»`, { error });
		return null;
	}
}

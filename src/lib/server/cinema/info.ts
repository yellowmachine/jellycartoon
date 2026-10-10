import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { movie, movieInfo, movieTitle } from '#lib/server/db/schema.ts';
import { openRouterConfig } from '#lib/server/app-settings.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { log } from '#lib/server/log.ts';
import { pick, queries, type Clues } from './match.ts';
import { describeCandidates, filmDetails, searchFilms } from './wikidata.ts';

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
	return save(movieId, { status: 'found', ...details, synopsis, synopsisSource, candidates: [] });
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

import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { movie, movieInfo, movieTitle } from '#lib/server/db/schema.ts';
import { chatConfig } from '#lib/server/app-settings.ts';
import { completeJson, type ContentPart } from '#lib/server/openrouter.ts';
import { log } from '#lib/server/log.ts';
import { FRAME_WIDTHS } from '#lib/birds-eye.ts';
import { formatDuration } from '#lib/format.ts';
import { sceneFrameAt, type SceneName } from '#lib/scenes.ts';
import { movieFrame } from './frames.ts';
import { filmArticles } from './wikidata.ts';

/**
 * Films whose scenes are being named, in the background: it takes a minute or two (a frame of
 * each chapter, then the AI), longer than a request should wait.
 */
const naming = new Map<number, Promise<void>>();
/** Why the last attempt failed, until it is tried again. */
const failures = new Map<number, string>();

export function namingState(movieId: number) {
	return { naming: naming.has(movieId), failed: failures.get(movieId) ?? null };
}

export function startNaming(movieId: number) {
	if (naming.has(movieId)) return;
	failures.delete(movieId);
	const job = nameScenes(movieId)
		.catch((error) => {
			failures.set(movieId, error instanceof Error ? error.message : String(error));
			log.error('cine', 'No se pudieron nombrar las escenas', { movieId, error });
		})
		.finally(() => naming.delete(movieId));
	naming.set(movieId, job);
}

const SYSTEM =
	'Eres un experto en cine. Pones nombre a las escenas de una película para que un cinéfilo pueda volver a cada una. ' +
	'Recibes los capítulos del fichero (los del disco), cada uno con la hora a la que empieza y un fotograma de poco después, y los artículos de Wikipedia sobre la película. ' +
	'Para cada capítulo, un nombre corto en español, de 2 a 7 palabras, que diga qué pasa en él: por ejemplo «Pongo y Perdita se conocen en el parque». ' +
	'Sitúalo con el argumento y con lo que se ve: los capítulos van en orden, como el argumento. ' +
	'Si no sabes qué pasa, nombra lo que se ve («Créditos iniciales», «Persecución en la nieve») en vez de inventarlo. ' +
	'Usa los nombres de los personajes de la versión española si los conoces.';

const SCHEMA = {
	type: 'object',
	properties: {
		scenes: {
			type: 'array',
			items: {
				type: 'object',
				properties: { chapter: { type: 'integer' }, name: { type: 'string' } },
				required: ['chapter', 'name'],
				additionalProperties: false
			}
		}
	},
	required: ['scenes'],
	additionalProperties: false
};

async function nameScenes(movieId: number) {
	const [film] = await db
		.select({
			title: movieTitle,
			status: movie.status,
			durationSec: movie.durationSec,
			chapters: movie.chapters,
			info: {
				status: movieInfo.status,
				wikidataId: movieInfo.wikidataId,
				title: movieInfo.title,
				originalTitle: movieInfo.originalTitle,
				year: movieInfo.year,
				directors: movieInfo.directors
			}
		})
		.from(movie)
		.leftJoin(movieInfo, eq(movieInfo.movieId, movie.id))
		.where(eq(movie.id, movieId));
	const chapters = film?.chapters;
	if (!film || film.status !== 'ready' || !film.durationSec || !chapters?.length)
		throw new Error('La película no tiene capítulos');
	if (film.info?.status !== 'found' || !film.info.wikidataId)
		throw new Error('Primero tiene que tener ficha');
	const { model } = await chatConfig();
	const duration = film.durationSec;

	const [articles, frames] = await Promise.all([
		filmArticles(film.info.wikidataId),
		// A missing frame is not worth failing for: the AI still has the time and the plot.
		Promise.all(
			chapters.map((_, i) =>
				movieFrame(movieId, sceneFrameAt(chapters, i, duration), FRAME_WIDTHS[0]).catch(() => null)
			)
		)
	]);

	const info = film.info;
	const prompt: ContentPart[] = [
		{
			type: 'text',
			text: [
				`Película: ${info.title ?? film.title}`,
				info.originalTitle && info.originalTitle !== info.title
					? `Título original: ${info.originalTitle}`
					: null,
				info.year ? `Año: ${info.year}` : null,
				info.directors.length ? `Dirección: ${info.directors.join(', ')}` : null,
				`Duración del fichero: ${formatDuration(duration)}`,
				...articles.map((a) => `\n## Wikipedia (${a.lang}): ${a.title}\n\n${a.text}`),
				`\n## Los ${chapters.length} capítulos`
			]
				.filter(Boolean)
				.join('\n')
		},
		...chapters.flatMap((c, i): ContentPart[] => [
			{
				type: 'text',
				text: `Capítulo ${i + 1} · empieza en ${formatDuration(c.startSec) || '0:00'}${frames[i] ? '' : ' (sin fotograma)'}`
			},
			...(frames[i]
				? [
						{
							type: 'image_url' as const,
							image_url: { url: `data:image/jpeg;base64,${frames[i].toString('base64')}` }
						}
					]
				: [])
		])
	];

	const { scenes } = await completeJson<{ scenes: { chapter: number; name: string }[] }>({
		system: SYSTEM,
		prompt,
		name: 'scenes',
		label: `Escenas de «${film.title}»`,
		details: { movieId },
		schema: SCHEMA,
		model,
		timeoutMs: 180_000
	});
	const names: SceneName[] = scenes
		.filter((s) => chapters[s.chapter - 1] && s.name.trim())
		.map((s) => ({
			startSec: chapters[s.chapter - 1].startSec,
			name: s.name.trim().slice(0, 100)
		}));
	if (!names.length) throw new Error('La IA no devolvió ningún nombre');
	await db.update(movieInfo).set({ scenes: names }).where(eq(movieInfo.movieId, movieId));
	log.info('cine', `Nombradas ${names.length} escenas de ${film.title}`, { movieId, model });
}

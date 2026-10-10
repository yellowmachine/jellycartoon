import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { movie, movieChatMessage, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { chatConfig } from '#lib/server/app-settings.ts';
import { streamChat, type ChatEvent, type ChatMessage } from '#lib/server/openrouter.ts';
import { formatDuration } from '#lib/format.ts';
import { savedMovieInfo, type MovieInfo } from './info.ts';
import { filmArticles, type Article } from './wikidata.ts';

export type ChatEntry = Pick<
	typeof movieChatMessage.$inferSelect,
	'id' | 'role' | 'content' | 'sources'
>;

/** Messages sent back to the model: enough to follow the thread. */
const HISTORY = 20;

export async function chatHistory(userId: string, movieId: number): Promise<ChatEntry[]> {
	return db
		.select({
			id: movieChatMessage.id,
			role: movieChatMessage.role,
			content: movieChatMessage.content,
			sources: movieChatMessage.sources
		})
		.from(movieChatMessage)
		.where(and(eq(movieChatMessage.userId, userId), eq(movieChatMessage.movieId, movieId)))
		.orderBy(asc(movieChatMessage.id));
}

export async function clearChat(userId: string, movieId: number) {
	await db
		.delete(movieChatMessage)
		.where(and(eq(movieChatMessage.userId, userId), eq(movieChatMessage.movieId, movieId)));
}

/**
 * Answers being written, to stop them with «Parar». Closing the page does not stop them (Bun
 * does not tell when the browser goes away): they are saved and shown the next time.
 */
const answering = new Map<string, { stop: AbortController; saved: Promise<void> }>();
const answerKey = (userId: string, movieId: number) => `${userId}:${movieId}`;

/** Resolves once what it said so far is saved. */
export async function stopAnswer(userId: string, movieId: number) {
	const running = answering.get(answerKey(userId, movieId));
	running?.stop.abort();
	await running?.saved;
}

/** The articles of the last films talked about: they go with every question. */
const articles = new Map<string, Promise<Article[]>>();

function cachedArticles(wikidataId: string) {
	let cached = articles.get(wikidataId);
	if (!cached) {
		cached = filmArticles(wikidataId);
		// Not kept if it failed: next question tries again.
		cached.catch(() => articles.delete(wikidataId));
		articles.set(wikidataId, cached);
		if (articles.size > 20) articles.delete(articles.keys().next().value!);
	}
	return cached;
}

/**
 * Answers a question about a film, as it is written. The question and the answer (also a partial
 * one, if it is stopped) are saved.
 */
export async function* ask(request: {
	userId: string;
	movieId: number;
	question: string;
}): AsyncGenerator<ChatEvent> {
	const { userId, movieId, question } = request;
	const config = await chatConfig();
	if (!config.apiKey) throw new Error('No hay clave de OpenRouter: ponla en Ajustes');

	const [film] = await db
		.select({
			title: movieTitle,
			year: movie.year,
			durationSec: movie.durationSec,
			positionSec: movieProgress.positionSec,
			completed: movieProgress.completed
		})
		.from(movie)
		.leftJoin(
			movieProgress,
			and(eq(movieProgress.movieId, movie.id), eq(movieProgress.userId, userId))
		)
		.where(eq(movie.id, movieId));
	if (!film) throw new Error('Película no encontrada');
	const info = await savedMovieInfo(movieId);
	const found = info?.status === 'found' ? info : null;
	const sources = found?.wikidataId ? await cachedArticles(found.wikidataId) : [];

	// A new question stops the previous answer, which is saved before it.
	await stopAnswer(userId, movieId);
	const history = await db
		.select({ role: movieChatMessage.role, content: movieChatMessage.content })
		.from(movieChatMessage)
		.where(and(eq(movieChatMessage.userId, userId), eq(movieChatMessage.movieId, movieId)))
		.orderBy(desc(movieChatMessage.id))
		.limit(HISTORY);
	await db.insert(movieChatMessage).values({ userId, movieId, role: 'user', content: question });

	const messages: ChatMessage[] = [
		{ role: 'system', content: systemPrompt({ film, found, sources, web: config.web }) },
		...history.reverse(),
		{ role: 'user', content: question }
	];

	const key = answerKey(userId, movieId);
	const stop = new AbortController();
	const saved = Promise.withResolvers<void>();
	const running = { stop, saved: saved.promise };
	answering.set(key, running);
	const { signal } = stop;

	let answer = '';
	const used: { url: string; title: string }[] = [];
	try {
		for await (const event of streamChat({ ...config, apiKey: config.apiKey, messages, signal })) {
			if ('text' in event) answer += event.text;
			else used.push(...event.sources);
			yield event;
		}
	} catch (err) {
		if (!signal.aborted) throw err;
		if (answer.trim()) yield { text: ' […]' };
	} finally {
		try {
			if (answer.trim())
				await db.insert(movieChatMessage).values({
					userId,
					movieId,
					role: 'assistant',
					content: signal.aborted ? `${answer.trim()} […]` : answer.trim(),
					sources: used
				});
		} finally {
			if (answering.get(key) === running) answering.delete(key);
			saved.resolve();
		}
	}
}

function systemPrompt({
	film,
	found,
	sources,
	web
}: {
	film: {
		title: string;
		year: number | null;
		durationSec: number | null;
		positionSec: number | null;
		completed: boolean | null;
	};
	found: MovieInfo | null;
	sources: Article[];
	web: boolean;
}) {
	const facts = found
		? [
				`Título: ${found.title}`,
				found.originalTitle && `Título original: ${found.originalTitle}`,
				found.year && `Año: ${found.year}`,
				found.directors.length && `Dirección: ${found.directors.join(', ')}`,
				found.cast.length && `Reparto: ${found.cast.join(', ')}`,
				found.genres.length && `Género: ${found.genres.join(', ')}`,
				found.countries.length && `País: ${found.countries.join(', ')}`,
				found.minutes && `Duración: ${found.minutes} min`
			]
		: [
				`Título (del nombre del fichero, sin confirmar): ${film.title}`,
				film.year && `Año: ${film.year}`,
				'No se ha identificado en Wikidata: si no sabes con seguridad qué película es, dilo.'
			];

	const spoilers = film.completed
		? 'Ya la ha visto entera: puedes hablar del argumento completo y del final.'
		: film.positionSec && film.positionSec > 60
			? `La está viendo y va por ${formatDuration(film.positionSec)}: no desveles lo que pasa después; si pregunta por ello, avisa antes de contarlo.`
			: 'Aún no la ha visto: no desveles giros ni el final; si pregunta por ellos, avisa antes de contarlo.';

	return [
		'Eres un cinéfilo con mucho oficio que conversa con alguien en su casa, desde el móvil, sobre una película de su colección.',
		'Responde en el idioma en que te pregunten, con un tono cercano y concreto. Sé breve: dos o tres párrafos cortos salvo que pidan más.',
		'Escribe texto plano, sin Markdown: ni asteriscos, ni almohadillas, ni listas con guiones. Separa los párrafos con una línea en blanco.',
		sources.length
			? 'Básate ante todo en los artículos de Wikipedia de abajo. Si añades algo que no está en ellos, hazlo solo si lo sabes con seguridad y di que no viene de Wikipedia. Nunca inventes fechas, nombres, cifras ni anécdotas: si no lo sabes, dilo.'
			: 'No hay artículos de Wikipedia de esta película. Responde solo con lo que sepas con seguridad, y di claramente cuando no lo sepas: nunca inventes fechas, nombres, cifras ni anécdotas.',
		web &&
			'Puedes buscar en la web para completar o comprobar datos; menciona de dónde sale lo que no está en Wikipedia.',
		spoilers,
		'',
		'Ficha de la película:',
		...facts.filter(Boolean),
		...sources.flatMap((a) => [
			'',
			`Artículo «${a.title}» de la Wikipedia en ${a.lang === 'es' ? 'español' : 'inglés'}:`,
			a.text
		])
	]
		.filter((line) => line !== false && line !== null && line !== 0 && line !== undefined)
		.join('\n');
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, seriesInfo } from '#lib/server/db/schema.ts';
import { chatConfig } from '#lib/server/app-settings.ts';
import { completeJson, type ContentPart } from '#lib/server/openrouter.ts';
import { log } from '#lib/server/log.ts';
import { FRAME_WIDTHS } from '#lib/birds-eye.ts';
import { formatDuration } from '#lib/format.ts';
import { titleBatches, type TitleProposal } from '#lib/episode-titles.ts';
import { inTurn } from '#lib/server/cinema/frames.ts';
import { wikipediaPageText } from '#lib/server/cinema/wikidata.ts';
import { frame, probe } from './ffmpeg.ts';
import { hlsDir, thumbFile } from './paths.ts';

/**
 * Series whose titles are being proposed, in the background: a request to the AI for every batch
 * of episodes, minutes for a long series. `done` of `total` batches.
 */
const proposing = new Map<number, { done: number; total: number; stop: AbortController }>();
/** Why the last attempt failed, until it is tried again. */
const failures = new Map<number, string>();

export function proposalState(seriesId: number) {
	const job = proposing.get(seriesId);
	return {
		progress: job ? { done: job.done, total: job.total, stopping: job.stop.signal.aborted } : null,
		failed: failures.get(seriesId) ?? null
	};
}

/**
 * Stops after cancelling the request in progress. What the finished batches proposed is kept, to
 * be reviewed like a whole proposal.
 */
export function stopProposal(seriesId: number) {
	proposing.get(seriesId)?.stop.abort();
}

/**
 * Only the episodes without a title from the AI (e.g. a season added later), unless `all`: the
 * others go along as text, so the AI knows how they are numbered.
 */
export function startProposal(seriesId: number, all = false) {
	if (proposing.has(seriesId)) return;
	failures.delete(seriesId);
	const job = { done: 0, total: 0, stop: new AbortController() };
	proposing.set(seriesId, job);
	proposeTitles(seriesId, all, job)
		.catch((error) => {
			failures.set(seriesId, error instanceof Error ? error.message : String(error));
			log.error('series', 'No se pudieron proponer los títulos', { seriesId, error });
		})
		.finally(() => proposing.delete(seriesId));
}

/** Enough of a long list of episodes (Shin Chan has hundreds) without sending a whole book. */
const PAGE_CHARS = 80_000;

/** Seconds of the frames from the start: classic cartoons show their title card there. */
const EARLY_FRAMES = [8, 20];

const SYSTEM =
	'Eres un experto en series de televisión y dibujos animados. Ordenas la colección doméstica de una serie: para cada fichero dices qué episodio es, con su temporada, su número y su título. ' +
	'Recibes la lista de episodios de Wikipedia y los ficheros en el orden de sus nombres, cada uno con su duración, su numeración y título actuales y algunos fotogramas: dos del principio (los dibujos clásicos suelen enseñar ahí el cartel con el título) y uno del medio. ' +
	'Los ficheros copiados de un disco (MakeMKV: _t00, Disc 2) suelen seguir el orden de emisión dentro de cada disco; los de YouTube traen el título en el nombre, a veces en otro idioma o con ruido del canal. ' +
	'Temporada y número, los de la lista; si la lista no tiene temporadas, temporada 1 y el número de la lista. ' +
	'Título: el de España si la lista lo da, o si no el original tal cual; no lo traduzcas tú. ' +
	'Si un fichero no es un episodio (un opening, unos extras, una pista que repite otra, un vídeo de otra cosa), isEpisode=false y en title di qué es, en español. ' +
	'Si un fichero tiene varios episodios seguidos, numéralo como el primero y une sus títulos con « / ». ' +
	'Si no sabes qué episodio es, devuelve la temporada, el número y el título que ya tiene: es mejor que inventarlo.';

const SCHEMA = {
	type: 'object',
	properties: {
		episodes: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					file: { type: 'integer' },
					isEpisode: { type: 'boolean' },
					season: { type: 'integer' },
					number: { type: 'integer' },
					title: { type: 'string' }
				},
				required: ['file', 'isEpisode', 'season', 'number', 'title'],
				additionalProperties: false
			}
		}
	},
	required: ['episodes'],
	additionalProperties: false
};

type Episode = Awaited<ReturnType<typeof seriesEpisodes>>[number];

function seriesEpisodes(seriesId: number) {
	return db
		.select({
			id: episode.id,
			season: episode.season,
			number: episode.number,
			title: episodeTitle,
			sourcePath: episode.sourcePath,
			aiTitle: episode.aiTitle,
			status: episode.status,
			durationSec: episode.durationSec
		})
		.from(episode)
		.where(and(eq(episode.seriesId, seriesId), eq(episode.missing, false)))
		.orderBy(asc(episode.season), asc(episode.number));
}

const jpeg = (image: Buffer): ContentPart => ({
	type: 'image_url',
	image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` }
});

/**
 * Frames from the start and the thumbnail (from the middle). Only of converted episodes, from
 * their HLS output: the original may be gone. A missing one is not worth failing for.
 */
async function episodeFrames(ep: Episode) {
	if (ep.status !== 'ready' || !ep.durationSec) return [];
	const input = path.join(hlsDir(ep.id), 'master.m3u8');
	const duration = ep.durationSec;
	const early = await inTurn(async () => {
		const info = await probe(input, undefined, false);
		return Promise.all(
			EARLY_FRAMES.filter((at) => at < duration - 1).map((at) =>
				frame(input, info, at, FRAME_WIDTHS[0], true)
			)
		);
	}).catch(() => []);
	const thumb = await readFile(thumbFile(ep.id)).catch(() => null);
	return [...early, ...(thumb ? [thumb] : [])];
}

const numbering = (p: { season: number; number: number }) => `T${p.season}x${p.number}`;

async function proposeTitles(
	seriesId: number,
	all: boolean,
	job: { done: number; total: number; stop: AbortController }
) {
	const { signal } = job.stop;
	const [info] = await db.select().from(seriesInfo).where(eq(seriesInfo.seriesId, seriesId));
	if (info?.status !== 'found') throw new Error('Primero tiene que tener ficha');
	const episodes = await seriesEpisodes(seriesId);
	if (!episodes.length) throw new Error('La serie no tiene episodios');
	const pending = all ? episodes : episodes.filter((e) => !e.aiTitle);
	if (!pending.length) throw new Error('Todos los capítulos tienen ya título de la IA');
	// Not an episode, for the AI: what was applied as such went to season 0.
	const done = (all ? [] : episodes.filter((e) => e.aiTitle)).map(
		(e): Omit<TitleProposal, 'episodeId'> => ({
			isEpisode: e.season !== 0,
			season: e.season,
			number: e.number,
			title: e.title
		})
	);
	const { model } = await chatConfig();

	const pages = await Promise.all(
		info.episodePages.map(async (page) => {
			const text = await wikipediaPageText(page);
			return `\n## Wikipedia (${page.lang}): ${page.title}\n\n${text.slice(0, PAGE_CHARS)}`;
		})
	);
	const header = [
		`Serie: ${info.title}`,
		info.originalTitle && info.originalTitle !== info.title
			? `Título original: ${info.originalTitle}`
			: null,
		info.startYear ? `Desde: ${info.startYear}` : null,
		info.seasons ? `Temporadas: ${info.seasons}` : null,
		info.episodes ? `Episodios: ${info.episodes}` : null,
		`Ficheros en la colección: ${episodes.length}`,
		done.length ? `Ya ordenados antes: ${done.length}; faltan: ${pending.length}` : null,
		...pages
	]
		.filter(Boolean)
		.join('\n');

	const batches = titleBatches(pending);
	job.total = batches.length;
	const proposal: TitleProposal[] = [];

	for (const batch of batches) {
		if (signal.aborted) break;
		const frames = await Promise.all(batch.map(episodeFrames));
		const ordered = [...done, ...proposal];
		const prompt: ContentPart[] = [
			{
				type: 'text',
				text: [
					header,
					// So the numbering goes on where the previous batch left it.
					ordered.length
						? `\n## Ya ordenados\n\n${ordered
								.map((p) => `${p.isEpisode ? numbering(p) : 'No es un episodio'}: ${p.title}`)
								.join('\n')}`
						: null,
					`\n## Los ${batch.length} ficheros de ahora`
				]
					.filter(Boolean)
					.join('\n')
			},
			...batch.flatMap((ep, i): ContentPart[] => [
				{
					type: 'text',
					text: `Fichero ${i + 1}: ${ep.sourcePath} · ${formatDuration(ep.durationSec) || 'duración desconocida'} · ahora ${numbering(ep)} «${ep.title}»${frames[i].length ? '' : ' (sin fotogramas)'}`
				},
				...frames[i].map(jpeg)
			])
		];

		const answer = await completeJson<{
			episodes: {
				file: number;
				isEpisode: boolean;
				season: number;
				number: number;
				title: string;
			}[];
		}>({
			system: SYSTEM,
			prompt,
			name: 'episodes',
			label: `Títulos de «${info.title}», lote ${job.done + 1} de ${job.total}`,
			details: { seriesId, files: batch.length },
			schema: SCHEMA,
			model,
			timeoutMs: 180_000,
			// 25 episodes, each with its title: a few thousand tokens.
			maxTokens: 8192,
			signal
		}).then(
			(a) => a.episodes,
			(error) => {
				if (signal.aborted) return null;
				throw error;
			}
		);
		if (!answer) break;
		const seen = new Set<number>();
		for (const a of answer) {
			const ep = batch[a.file - 1];
			const title = a.title.trim().slice(0, 200);
			if (!ep || seen.has(ep.id) || !title || a.season < 0 || a.number < 0) continue;
			seen.add(ep.id);
			proposal.push({
				episodeId: ep.id,
				isEpisode: a.isEpisode,
				season: a.season,
				number: a.number,
				title
			});
		}
		job.done++;
	}

	if (signal.aborted) {
		log.info('series', `Detenida la propuesta de títulos de ${info.title}`, {
			seriesId,
			batches: `${job.done}/${job.total}`
		});
		if (!proposal.length) return;
	}
	if (!proposal.length) throw new Error('La IA no devolvió ningún título');
	await db
		.update(seriesInfo)
		.set({ titleProposal: proposal })
		.where(eq(seriesInfo.seriesId, seriesId));
	log.info('series', `Propuestos ${proposal.length} títulos para ${info.title}`, {
		seriesId,
		model
	});
}

/**
 * Applies the proposal to the chosen episodes: the AI's title, and its season and number, which
 * scans then leave alone. What is not an episode goes to the end of season 0. What was not chosen
 * is discarded with the rest of the proposal.
 */
export async function applyProposal(seriesId: number, episodeIds: number[]) {
	const [info] = await db
		.select({ proposal: seriesInfo.titleProposal })
		.from(seriesInfo)
		.where(eq(seriesInfo.seriesId, seriesId));
	const proposal = info?.proposal ?? [];
	const chosen = new Set(episodeIds);
	const applied = proposal.filter((p) => chosen.has(p.episodeId));

	await db.transaction(async (tx) => {
		const [{ last }] = await tx
			.select({ last: sql<number>`coalesce(max(${episode.number}), 0)::int` })
			.from(episode)
			.where(
				and(
					eq(episode.seriesId, seriesId),
					eq(episode.season, 0),
					notInArray(
						episode.id,
						applied.map((p) => p.episodeId)
					)
				)
			);
		let extra = last;
		for (const p of applied) {
			await tx
				.update(episode)
				.set({
					aiTitle: p.title,
					season: p.isEpisode ? p.season : 0,
					number: p.isEpisode ? p.number : ++extra,
					manualNumbering: true
				})
				.where(and(eq(episode.id, p.episodeId), eq(episode.seriesId, seriesId)));
		}
		await tx
			.update(seriesInfo)
			.set({ titleProposal: null })
			.where(eq(seriesInfo.seriesId, seriesId));
	});
	log.info(
		'series',
		`Aplicados ${applied.length} títulos de la IA, descartados ${proposal.length - applied.length}`,
		{ seriesId, episodeIds: applied.map((p) => p.episodeId) }
	);
	return applied.length;
}

export async function discardProposal(seriesId: number) {
	const [discarded] = await db
		.update(seriesInfo)
		.set({ titleProposal: null })
		.where(eq(seriesInfo.seriesId, seriesId))
		.returning({ title: seriesInfo.title });
	log.info('series', `Descartada la propuesta de títulos de ${discarded?.title ?? 'una serie'}`, {
		seriesId
	});
}

/** The episodes of the proposal that still exist, with what they are called now. */
export async function proposalRows(seriesId: number, proposal: TitleProposal[]) {
	if (!proposal.length) return [];
	const current = await db
		.select({
			id: episode.id,
			season: episode.season,
			number: episode.number,
			title: episodeTitle,
			customTitle: episode.customTitle,
			sourcePath: episode.sourcePath
		})
		.from(episode)
		.where(
			and(
				eq(episode.seriesId, seriesId),
				inArray(
					episode.id,
					proposal.map((p) => p.episodeId)
				)
			)
		);
	const byId = new Map(current.map((e) => [e.id, e]));
	return proposal.flatMap((p) => {
		const now = byId.get(p.episodeId);
		return now ? [{ ...p, now }] : [];
	});
}

import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { APP_VERSION } from '$app/env/private';
import { subtitlesPaused } from '#lib/server/app-settings.ts';
import { FILM_DETAILS_VERSION } from '#lib/server/cinema/info.ts';
import { db } from '#lib/server/db/index.ts';
import { episode, movie, movieInfo, subtitleJob, track } from '#lib/server/db/schema.ts';
import { NIGHTLY_SCAN_HOUR } from '#lib/server/library/nightly.ts';
import { cinemaRoot, musicRoot } from '#lib/server/library/paths.ts';
import { workerStatus } from '#lib/server/library/worker.ts';
import { log } from '#lib/server/log.ts';
import { voiceEnabled } from '#lib/server/voice/whisper.ts';

/**
 * One line in the Registro when the server starts: which version, and in what state each piece
 * of work in the background starts (what waits, what is paused), so that «why was this not done?»
 * has an answer there. Each piece says itself what it does next.
 */

async function howMany(query: Promise<{ n: number }[]>) {
	return (await query)[0]?.n ?? 0;
}

const n = sql<number>`count(*)::int`;
const STATES = { running: 'en marcha', paused: 'en pausa', stopped: 'parada' };

export async function logStartup() {
	try {
		const [episodes, subtitles, paused, films, stale, tracks, opus] = await Promise.all([
			howMany(
				db
					.select({ n })
					.from(episode)
					.where(and(eq(episode.status, 'pending'), eq(episode.missing, false)))
			),
			voiceEnabled
				? howMany(db.select({ n }).from(subtitleJob).where(eq(subtitleJob.state, 'queued')))
				: 0,
			voiceEnabled ? subtitlesPaused() : false,
			cinemaRoot
				? howMany(
						db
							.select({ n })
							.from(movie)
							.where(and(eq(movie.status, 'pending'), eq(movie.missing, false)))
					)
				: 0,
			cinemaRoot
				? howMany(
						db
							.select({ n })
							.from(movieInfo)
							.where(
								and(
									eq(movieInfo.status, 'found'),
									isNotNull(movieInfo.wikidataId),
									lt(movieInfo.detailsVersion, FILM_DETAILS_VERSION)
								)
							)
					)
				: 0,
			musicRoot
				? howMany(
						db
							.select({ n })
							.from(track)
							.where(and(eq(track.status, 'pending'), eq(track.missing, false)))
					)
				: 0,
			musicRoot
				? howMany(
						db
							.select({ n })
							.from(track)
							.where(
								and(eq(track.status, 'ready'), eq(track.opus, 'pending'), eq(track.missing, false))
							)
					)
				: 0
		]);
		const worker = workerStatus().state;
		const parts = [
			`conversión ${STATES[worker]}, ${episodes} ${episodes === 1 ? 'pendiente' : 'pendientes'}`,
			...(voiceEnabled
				? [`subtítulos ${paused ? 'en pausa' : 'en marcha'}, ${subtitles} en cola`]
				: []),
			...(cinemaRoot ? [`películas: ${films} por catalogar, ${stale} fichas por completar`] : []),
			...(musicRoot ? [`música: ${tracks} pistas por leer, ${opus} por comprimir en Opus`] : []),
			`escaneo nocturno a las ${NIGHTLY_SCAN_HOUR}:00`
		];
		log.info(
			'arranque',
			`Arranque${APP_VERSION ? ` de la ${APP_VERSION}` : ''}: ${parts.join(' · ')}`,
			{
				version: APP_VERSION ?? null,
				worker,
				episodes,
				subtitles,
				subtitlesPaused: paused,
				films,
				staleInfo: stale,
				tracks,
				opus
			}
		);
	} catch (error) {
		log.error('arranque', 'No se pudo resumir el arranque', { error });
	}
}

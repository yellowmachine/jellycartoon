import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { searchVideo, seriesEpisodes } from '#lib/server/voice/video.ts';
import { MAX_CLIP_MINUTES, sendClip } from '#lib/server/langua.ts';
import { playEpisodes, seriesQueue } from '#lib/server/cinema/episode-actions.ts';
import { playFilm } from '#lib/server/cinema/film-actions.ts';
import { askAloud } from '#lib/server/cinema/chat.ts';
import { chatConfig } from '#lib/server/app-settings.ts';
import type { Tool } from '#lib/server/openrouter.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, movie, movieTitle, series } from '#lib/server/db/schema.ts';
import { getAlbums, tracksById } from '#lib/server/music/albums.ts';
import { searchMusic } from '#lib/server/voice/music-search.ts';
import { getPlaylist, listPlaylists } from '#lib/server/music/playlists.ts';
import {
	controlSnapcast,
	listSpeakers,
	queueOnSnapcast,
	radioOnSnapcast,
	snapcastNow,
	snapcastReady,
	soundOn,
	stopAfterTrackOnSnapcast,
	stopOnSnapcastIn
} from '#lib/server/music/snapcast.ts';
import { episodesOnSnapcast } from '#lib/server/music/episodes-on-snapcast.ts';
import { streamFor } from '#lib/server/radio.ts';
import { keepsHistory } from '#lib/server/settings.ts';
import {
	HISTORY_TOOLS,
	historyRules,
	historySince,
	historyTools,
	runHistoryTool,
	todayText,
	type Person
} from '#lib/server/watch-history.ts';
import {
	fold,
	masterVolume,
	type MusicAlbum,
	type MusicTrack,
	type SnapcastWhere
} from 'comun/music.ts';
import { STATIONS } from 'comun/radio.ts';
import type { LngLat } from 'comun/road.ts';
import { askCloud, linked } from '#lib/server/kitchen.ts';
import type { AlarmPlace } from 'comun/alarms.ts';
import {
	cancelTimersAt,
	describeTimersAt,
	prepareTimerAt,
	startTimerAt
} from '#lib/server/alarms/alarms.ts';
import { allSatellites, cloudSatellite, type Satellite } from '#lib/server/satellites.ts';
import {
	runTelegramTool,
	TELEGRAM_TOOLS,
	telegramTools
} from '#lib/server/voice/telegram-tools.ts';
import { allowedMovies, isKidAccount } from '#lib/server/kids.ts';
import { findPlaces, forecast, housePlace, placeName } from '#lib/server/weather.ts';
import {
	MAX_STOP_LATER_MIN,
	MAX_TIMER_SEC,
	type VoiceAction,
	type VoiceControl,
	type VoiceReply,
	type VoiceRequest,
	type VideoHere
} from 'comun/voice.ts';
import type {
	HouseHandResult,
	HouseVoiceOrder,
	VoiceRoom,
	VoiceTiming
} from 'comun/house-voice.ts';

/**
 * The house's part of the voice (#33), whose brain is in the cloud since #253: each order goes
 * there with what only the house knows (its music, what sounds, its speakers, what each one
 * watched), and the cloud asks back for what only the house can do (its hands: the music and the
 * speakers, the videos, the satellites' timers, the weather and the routes, Langua…), in that
 * order's name, while it lasts.
 */

/** With more albums than this, the instructions list only the artists, and it searches the rest. */
const LISTED_ALBUMS = 400;
/** «Más alto» and «más bajo», on the 0–100 of Snapcast's master volume. */
const VOLUME_STEP = 15;
/** The longest an order waits for the cloud: some turns with the AI and its tools. */
const ORDER_MS = 90_000;

type ToolResult = string;

/** What the hands collect for the answer, as they run. */
interface Outcome {
	actions: VoiceAction[];
	/** Done here, by the server, as an action for the device would be: a satellite's timer (#241). */
	done: number;
}

type Room = VoiceRoom;

/** An order going on: what its hands need, kept until it is answered. */
interface Order {
	albums: MusicAlbum[];
	playlists: { id: number; name: string }[];
	house: boolean;
	rooms: Room[];
	user: Person;
	video: VideoHere | null;
	/** Where we are, in the road mode. */
	position: LngLat | null;
	/** Said to a voice satellite (#223), which plays nothing itself. */
	satellite: boolean;
	/** Where its timers are kept by the server (#241): a satellite's; null, a phone's. */
	place: AlarmPlace | null;
	/** The satellite's name, said to one (#243): «Desde el salón». */
	satelliteName: string | null;
	/** A satellite that is a speaker itself (#296, `ownSpeaker`): its Snapcast id, its «aquí». */
	satelliteSpeaker: string | null;
	/** This order's own id: a message is never sent in the order that prepared it (#243). */
	order: string;
	/** The film whose card is on the screen, to ask about it (`ask_about_film`). */
	film: number | null;
}

const orders = new Map<string, Order>();

/** The library for the instructions: each artist with their albums, or only the artists. */
function libraryLines(albums: MusicAlbum[]) {
	const byArtist = new Map<string, MusicAlbum[]>();
	for (const a of albums) byArtist.set(a.artist, [...(byArtist.get(a.artist) ?? []), a]);
	return albums.length <= LISTED_ALBUMS
		? [...byArtist].map(
				([artist, list]) =>
					`- ${artist}: ${list.map((a) => `${a.title} [álbum ${a.id}]`).join('; ')}`
			)
		: [...byArtist.keys()].map((artist) => `- ${artist}`);
}

/**
 * An order, opened: what only the house knows, for the cloud's AI, and what its hands will need,
 * kept until `close` (or `ORDER_MS`, if the cloud never says). `user`: who speaks; `satellite`:
 * said to a voice satellite (#223), by anyone in the room: `user` is who made its key, in whose name
 * what it does goes, but without their name nor what they watch.
 */
async function openOrder(
	request: VoiceRequest,
	user: Person,
	satellite: Satellite | null = null
): Promise<{ body: HouseVoiceOrder; close: () => void }> {
	const place: AlarmPlace | null = satellite ? `satelite:${satellite.id}` : null;
	const order = randomUUID();
	// In the car the house's speakers are far away.
	const house = snapcastReady() && !request.car;
	const [albums, playlists, { hoursSince }, keepHistory, watching, timers, satellites, kid, rooms] =
		await Promise.all([
			getAlbums(),
			listPlaylists(),
			historySince(satellite ? [] : [user]),
			satellite ? true : keepsHistory(user.id),
			videoText(request.video),
			place ? describeTimersAt(place) : [],
			allSatellites(),
			satellite ? false : isKidAccount(user.id),
			house
				? listSpeakers().then((list) => (list ?? []).map((s) => ({ id: s.id, name: s.name })))
				: []
		]);
	// Not a satellite's: it has no screen. Nor a child's: no conversations with the AI (#17).
	const film = satellite || kid ? null : await filmToAsk(request.film);
	const tools = [
		...(satellite ? [] : historyTools({ self: user })),
		...(await telegramTools(user.id, Boolean(satellite))),
		...(film ? [askFilmTool] : [])
	];
	orders.set(order, {
		albums,
		playlists,
		house,
		rooms,
		user,
		video: request.video,
		position: request.position,
		satellite: Boolean(satellite),
		place,
		satelliteName: satellite?.name ?? null,
		satelliteSpeaker: satellite?.ownSpeaker ? satellite.speakerId : null,
		order,
		film: film?.id ?? null
	});
	const expiry = setTimeout(() => orders.delete(order), ORDER_MS);
	return {
		body: {
			order,
			request,
			who: { name: satellite ? '' : user.name, kid },
			satellite: satellite
				? { id: satellite.id, name: satellite.name, ownSpeaker: Boolean(satellite.ownSpeaker) }
				: null,
			house: {
				library: libraryLines(albums),
				playlists,
				speakers: house,
				rooms,
				salon: mpvEnabled,
				clipMinutes: MAX_CLIP_MINUTES,
				historyRules: historyRules(hoursSince),
				keepHistory,
				today: todayText(),
				sounding: soundingNow(request.here, house),
				watching:
					[
						watching,
						film &&
							`[En la pantalla, la ficha de la película «${film.title}»${film.year ? ` (${film.year})` : ''} [película ${film.id}]: lo que pregunte de ella, con ask_about_film.]`
					]
						.filter(Boolean)
						.join('\n') || null,
				timers,
				satellites: satellites.map(({ id, name }) => ({ id, name })),
				tools
			}
		},
		close: () => {
			clearTimeout(expiry);
			orders.delete(order);
		}
	};
}

/**
 * What was said here, to the cloud's AI with what the house knows, and back: what the device must
 * do, and the sentence to read aloud. A child's account has no voice.
 */
export async function runVoiceCommand(
	request: VoiceRequest,
	user: Person,
	satellite: Satellite | null = null
): Promise<VoiceReply & { timing: VoiceTiming }> {
	const started = performance.now();
	const { body, close } = await openOrder(request, user, satellite);
	const prepareMs = Math.round(performance.now() - started);
	try {
		const reply = await askCloud<VoiceReply & { timing: VoiceTiming }>(await linked(), '/voz', {
			userId: satellite ? null : user.id,
			body,
			timeoutMs: ORDER_MS
		});
		return { ...reply, timing: { ...reply.timing, prepareMs: prepareMs + reply.timing.prepareMs } };
	} finally {
		close();
	}
}

/**
 * An order said to the cloud itself (#253), by one of the house: what the house knows, for its AI;
 * its hands answer to it for `ORDER_MS`. From its road mode (`car`), driving: no speakers of the
 * house; from its Hablar, on a phone away, they may be asked for («ponlo en el salón»). Nothing to
 * watch there yet: its video is the house's.
 */
export async function orderFromCloud(request: VoiceRequest, user: Person) {
	return (await openOrder({ ...request, video: null }, user)).body;
}

/**
 * An order said to one of the satellites Seilide serves (#296), as said to one of the house's: by
 * anyone in the room, with its own snapclient as its speaker if it has one (`cloudSatellite`).
 * Null if the house has no one to do it in the name of.
 */
export async function orderForCloudSatellite(
	request: VoiceRequest,
	{ id, name, speaker }: { id: string; name: string; speaker: string | null }
) {
	const found = await cloudSatellite(id, name, speaker);
	if (!found) return null;
	return (await openOrder({ ...request, video: null }, found.owner, found.satellite)).body;
}

/** One of the house's tools, asked by the cloud's AI for an order going on; null, no such order. */
export async function runHand(
	orderId: string,
	name: string,
	args: Record<string, unknown>
): Promise<HouseHandResult | null> {
	const order = orders.get(orderId);
	if (!order) return null;
	const outcome: Outcome = { actions: [], done: 0 };
	let result: ToolResult;
	try {
		result = await hand(name, args, { ...order, outcome });
	} catch (err) {
		result = `Error: ${err instanceof Error ? err.message : String(err)}`;
	}
	return { result, ...outcome };
}

async function hand(
	name: string,
	args: Record<string, unknown>,
	ctx: Order & { outcome: Outcome }
): Promise<ToolResult> {
	if (HISTORY_TOOLS.has(name)) return runHistoryTool(name, args, { self: ctx.user });
	if (TELEGRAM_TOOLS.has(name))
		return runTelegramTool(name, args, {
			userId: ctx.user.id,
			satellite: ctx.satelliteName,
			order: ctx.order
		});
	if (name === 'ask_about_film') {
		const question = typeof args.question === 'string' ? args.question.trim() : '';
		if (!ctx.film) return 'No hay ninguna película en la pantalla.';
		if (!question) return 'Falta la pregunta.';
		return (await askAloud(ctx.user.id, ctx.film, question)) || 'No ha sabido qué contestar.';
	}
	// A satellite's «aquí» has nothing to play on: music, radio and their controls, in the whole house;
	// or, one of Seilide's that plays the house's music itself (#296), on its own snapclient.
	const satelliteHere =
		ctx.satellite && HOUSE_FROM_SATELLITE.has(name) && (!args.where || args.where === 'here');
	const own = satelliteHere && ctx.house ? ctx.satelliteSpeaker : null;
	const asked = satelliteHere && !own ? 'house' : args.where;
	const room = own
		? { id: own, name: ctx.satelliteName ?? 'el satélite' }
		: ctx.house
			? ctx.rooms.find((r) => fold(r.name) === fold(String(asked)))
			: undefined;
	// Snapcast: all its speakers, or only one; else this device.
	const where: 'here' | SnapcastWhere = room
		? { speakerId: room.id }
		: asked === 'house' && ctx.house
			? 'house'
			: 'here';
	if (asked === 'house' && !ctx.house) return 'Toda la casa (Snapcast) no está disponible.';
	const there =
		where === 'here' ? 'el dispositivo' : room ? `el altavoz «${room.name}»` : 'toda la casa';
	switch (name) {
		case 'search_music':
			return typeof args.query === 'string' && args.query.trim()
				? searchMusic(args.query, ctx.albums, ctx.playlists)
				: 'Falta qué buscar.';
		case 'play_music': {
			const music = await resolveMusic(String(args.kind), String(args.id ?? ''), ctx.albums);
			if (!music) return `No hay ${args.kind} con id «${args.id}». Búscalo con search_music.`;
			const shuffle = typeof args.shuffle === 'boolean' ? args.shuffle : args.kind === 'artist';
			if (where !== 'here') {
				await soundOn(where);
				await playHouse(music.tracks, music.start, shuffle);
			} else ctx.outcome.actions.push({ kind: 'play', ...music, shuffle });
			return `Sonando «${music.name}» (${music.tracks.length} canciones) en ${there}.`;
		}
		case 'play_radio': {
			const station = STATIONS.find((s) => s.uuid === args.id);
			if (!station) return `No hay emisora con id «${args.id}».`;
			if (where !== 'here') {
				const stream = await streamFor(station.uuid);
				if (!stream) return `${station.name} no está disponible ahora.`;
				await soundOn(where);
				await radioOnSnapcast(stream);
			} else ctx.outcome.actions.push({ kind: 'radio', uuid: station.uuid });
			return `Sonando ${station.name} en ${there}.`;
		}
		case 'control': {
			const action = args.action as VoiceControl;
			if (!['pause', 'resume', 'next', 'previous', 'stop', 'stopAfterTrack'].includes(action))
				return `Acción no válida: «${args.action}».`;
			// One queue on Snapcast, wherever it sounds.
			if (where !== 'here') {
				if (action === 'stopAfterTrack')
					return (await stopAfterTrackOnSnapcast())
						? `Se parará al acabar la canción que suena en ${there}.`
						: `En ${there} no suena una canción (la radio, o nada): no hay final que esperar.`;
				await controlHouse(action);
			} else ctx.outcome.actions.push({ kind: 'control', action });
			return 'Hecho.';
		}
		case 'stop_later': {
			const minutes = Math.round(Number(args.minutes));
			if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_STOP_LATER_MIN)
				return `Minutos no válidos: de 0 a ${MAX_STOP_LATER_MIN}.`;
			if (where !== 'here') stopOnSnapcastIn(minutes);
			else ctx.outcome.actions.push({ kind: 'stopIn', minutes });
			return minutes
				? `La música de ${there} se parará dentro de ${minutes} minutos, al acabar la canción que suene.`
				: `Quitado: la música de ${there} ya no se parará sola.`;
		}
		case 'get_weather': {
			const asked = typeof args.place === 'string' ? args.place.trim() : '';
			const house = await housePlace();
			let where: { lat: number; lon: number; name: string } | null = null;
			if (asked) {
				// «Toledo» is first in Ohio: one in the house's country if there is one.
				const found = await findPlaces(asked, 10);
				const place = found.find((p) => p.country === (house?.country ?? 'España')) ?? found[0];
				if (!place) return `No encuentro «${asked}». Díselo.`;
				where = { lat: place.lat, lon: place.lon, name: placeName(place) };
			} else if (ctx.position) {
				where = { lon: ctx.position[0], lat: ctx.position[1], name: 'donde está ahora' };
			} else if (house) {
				where = { lat: house.lat, lon: house.lon, name: placeName(house) };
			}
			if (!where)
				return 'No se sabe dónde está la casa: se pone en Ajustes → Casa, «Dónde está la casa». Díselo.';
			return `El tiempo en ${where.name}:\n${await forecast(where.lat, where.lon)}`;
		}
		case 'set_volume': {
			if (!ctx.house) return 'El volumen del dispositivo se cambia con sus botones.';
			const speakers = snapcastNow().speakers;
			if (!speakers?.length) return 'No se puede consultar el volumen de la casa ahora.';
			const now = masterVolume(speakers);
			const value =
				args.change === 'up'
					? now + VOLUME_STEP
					: args.change === 'down'
						? now - VOLUME_STEP
						: Number(args.value);
			if (!Number.isFinite(value)) return 'Falta el valor del volumen.';
			const to = Math.round(Math.min(Math.max(value, 0), 100));
			await controlSnapcast({ action: 'masterVolume', value: to });
			return `Volumen de la casa de ${now} a ${to}.`;
		}
		case 'send_clip': {
			const minutes = Number(args.minutes);
			if (!Number.isFinite(minutes) || minutes <= 0) return 'Faltan los minutos.';
			return sendClip(ctx.user.id, {
				minutes,
				language: typeof args.language === 'string' ? args.language : null,
				video: ctx.video
			});
		}
		case 'search_video':
			return typeof args.query === 'string' && args.query.trim()
				? searchVideo(ctx.user.id, args.query)
				: 'Falta qué buscar.';
		case 'series_episodes': {
			const seriesId = Number(args.series_id);
			if (!Number.isInteger(seriesId)) return 'Falta el id de la serie.';
			const season = args.season === undefined ? undefined : Number(args.season);
			if (season !== undefined && !Number.isInteger(season)) return 'Temporada no válida.';
			return seriesEpisodes(ctx.user.id, seriesId, season);
		}
		case 'play_video':
			return playVideo(args, { ...ctx, where, there });
		case 'set_timer': {
			const minutes = Number(args.minutes);
			if (!Number.isFinite(minutes) || minutes <= 0) return 'Falta cuántos minutos.';
			const seconds = Math.round(Math.min(minutes * 60, MAX_TIMER_SEC));
			const label = typeof args.label === 'string' ? args.label.trim().slice(0, 60) : '';
			// A satellite's, kept by the server (#241).
			if (ctx.place) {
				const name = await startTimerAt(ctx.place, { label, seconds, userId: ctx.user.id });
				ctx.outcome.done++;
				return `Temporizador «${name}» de ${seconds} segundos puesto.`;
			}
			ctx.outcome.actions.push({ kind: 'timer', label, seconds });
			return `Temporizador${label ? ` «${label}»` : ''} de ${seconds} segundos puesto en el dispositivo.`;
		}
		case 'prepare_timer': {
			const minutes = Number(args.minutes);
			if (!Number.isFinite(minutes) || minutes <= 0) return 'Falta cuántos minutos.';
			const trigger = typeof args.trigger === 'string' ? args.trigger.trim().slice(0, 100) : '';
			if (!trigger) return 'Falta cuándo tiene que arrancar.';
			const seconds = Math.round(Math.min(minutes * 60, MAX_TIMER_SEC));
			const label = typeof args.label === 'string' ? args.label.trim().slice(0, 60) : '';
			if (ctx.place) {
				const name = await prepareTimerAt(ctx.place, {
					label,
					seconds,
					trigger,
					userId: ctx.user.id
				});
				ctx.outcome.done++;
				return `Preparado «${name}»: ${seconds} segundos cuando ${trigger}.`;
			}
			ctx.outcome.actions.push({ kind: 'prepareTimer', label, seconds, trigger });
			return `Preparado${label ? ` «${label}»` : ''}: ${seconds} segundos cuando ${trigger}.`;
		}
		case 'cancel_timer': {
			const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim() : null;
			if (ctx.place) {
				const count = await cancelTimersAt(ctx.place, label);
				ctx.outcome.done++;
				return count
					? `Quitados: ${count}.`
					: `No hay ningún temporizador${label ? ` «${label}»` : ''}.`;
			}
			ctx.outcome.actions.push({ kind: 'cancelTimer', label });
			return label ? `Quitado el temporizador «${label}».` : 'Quitados todos los temporizadores.';
		}
		default:
			return `La casa no tiene la herramienta «${name}».`;
	}
}

/** The episode in this device's player, for the AI: «manda esto a Langua» is about it. */
/**
 * Asked about the film on the screen: what it knows of it (Wikipedia, its card), as its written
 * conversation does, and in it.
 */
const askFilmTool: Tool = {
	type: 'function',
	function: {
		name: 'ask_about_film',
		description:
			'Pregunta sobre la película de la pantalla (de qué va, quién sale, si es para niños, curiosidades, premios…) a quien la conoce: con sus artículos de Wikipedia, sin destripar lo que no ha visto. Devuelve la respuesta lista para decir: dila tal cual. Para ponerla, play_video.',
		parameters: {
			type: 'object',
			properties: {
				question: { type: 'string', description: 'La pregunta, como la dijo.' }
			},
			required: ['question']
		}
	}
};

/** The film of the card on the screen, if it can be talked about (an OpenRouter key). */
async function filmToAsk(id: number | null) {
	if (!id || !(await chatConfig()).apiKey) return null;
	const [film] = await db
		.select({ id: movie.id, title: movieTitle, year: movie.year })
		.from(movie)
		.where(and(eq(movie.id, id), eq(movie.missing, false), allowedMovies()));
	return film ?? null;
}

async function videoText(video: VideoHere | null) {
	if (!video) return null;
	const [ep] = await db
		.select({
			title: episodeTitle,
			seriesTitle: series.title,
			season: episode.season,
			number: episode.number
		})
		.from(episode)
		.innerJoin(series, eq(series.id, episode.seriesId))
		.where(eq(episode.id, video.episodeId));
	if (!ep) return null;
	return `[Viendo aquí, en pausa mientras habla: «${ep.seriesTitle}» T${ep.season} E${ep.number} «${ep.title}» [episodio ${video.episodeId}], minuto ${Math.floor(video.positionSec / 60)}.]`;
}

function soundingNow(here: string | null, house: boolean) {
	const snap = house ? snapcastNow() : null;
	const what = (s: NonNullable<typeof snap>) =>
		s.radio
			? `la radio ${s.radio.name}`
			: s.episode
				? `el audio del capítulo «${s.episode.subtitle}: ${s.episode.title}» [episodio ${s.episode.id}]`
				: `«${s.track?.title}» de ${s.track?.artist}`;
	// In the house's time (TZ, compose.prod.yaml).
	const when = (at: number) =>
		new Date(at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
	const inHouse = !snap?.active
		? 'nada'
		: [
				what(snap),
				snap.paused ? ' (en pausa)' : '',
				snap.stopAfterTrack ? ' (se para al acabar esta canción)' : '',
				snap.stopAt ? ` (se para a las ${when(snap.stopAt)}, al acabar la canción de entonces)` : ''
			].join('');
	return `[Ahora suena. Aquí: ${here ?? 'nada'}.${house ? ` Toda la casa: ${inHouse}.` : ''}]`;
}

const sameArtist = (a: string, b: string) => fold(a) === fold(b);

/** The tracks to play for `kind` and `id`, and where in them to start. */
async function resolveMusic(kind: string, id: string, albums: MusicAlbum[]) {
	const n = Number(id);
	switch (kind) {
		case 'album': {
			const album = albums.find((a) => a.id === n);
			return album ? { tracks: album.tracks, start: 0, name: album.title } : null;
		}
		case 'playlist': {
			const playlist = Number.isInteger(n) ? await getPlaylist(n) : null;
			return playlist?.items.length
				? { tracks: playlist.items.map((i) => i.track), start: 0, name: playlist.name }
				: null;
		}
		case 'artist': {
			const tracks = albums.filter((a) => sameArtist(a.artist, id)).flatMap((a) => a.tracks);
			return tracks.length ? { tracks, start: 0, name: id } : null;
		}
		case 'track': {
			// Only the song: «pon Bohemian Rhapsody» is not its whole album (2026-10-27).
			const track = albums.flatMap((a) => a.tracks).find((t) => t.id === n);
			return track ? { tracks: [track], start: 0, name: track.title } : null;
		}
		default:
			return null;
	}
}

async function playHouse(tracks: MusicTrack[], start: number, shuffle: boolean) {
	await controlSnapcast({ action: 'shuffle', value: shuffle });
	const found = await tracksById(tracks.map((t) => t.id));
	await queueOnSnapcast(found, {
		replace: true,
		start: shuffle ? Math.floor(Math.random() * found.length) : start
	});
}

async function controlHouse(action: Exclude<VoiceControl, 'stopAfterTrack'>) {
	if (action === 'pause' || action === 'resume')
		return controlSnapcast({ action: 'pause', value: action === 'pause' });
	return controlSnapcast({ action });
}

/** An episode here (the device opens its player) or in the living room; a film, only there. */
async function playVideo(
	args: Record<string, unknown>,
	ctx: {
		outcome: Outcome;
		user: Person;
		video: VideoHere | null;
		where: 'here' | SnapcastWhere;
		there: string;
	}
) {
	const id = Number(args.id);
	if (!Number.isInteger(id)) return 'Falta el id del capítulo o la película.';
	const minute = Number(args.start_minute);
	const startSec =
		args.start_minute === undefined || !Number.isFinite(minute)
			? null
			: Math.max(0, Math.round(minute * 60));
	const salon = args.where === 'salon';
	if (salon && !mpvEnabled) return 'No hay salón (mpv) configurado.';
	// Only its audio, on Snapcast (#223): the episode and the ones after it.
	if (ctx.where !== 'here' && !salon) {
		if (args.kind !== 'episode') return 'De las películas no se puede poner solo el audio.';
		const playing = await episodesOnSnapcast(ctx.user.id, id, startSec, ctx.where);
		// «Sigue con esto en el dormitorio»: what was being watched here stops.
		if (ctx.video?.episodeId === id) ctx.outcome.actions.push({ kind: 'handOver' });
		return `Sonando solo el audio de «${playing.subtitle}: ${playing.title}» en ${ctx.there}${fromMinute(startSec)}, y los siguientes.`;
	}

	if (args.kind === 'film') {
		if (!salon) return 'Las películas solo se ven en el salón: pregúntale si la pones allí.';
		const result = await playFilm(
			ctx.user.id,
			id,
			startSec === null ? 'resume' : startSec === 0 ? 'start' : { atSec: startSec }
		);
		return played(result, startSec);
	}
	if (args.kind !== 'episode') return `Tipo no válido: «${args.kind}».`;

	if (salon) {
		const result = await playEpisodes(
			ctx.user.id,
			await seriesQueue(ctx.user.id, id),
			startSec ?? undefined
		);
		return played(result, startSec);
	}
	const [ep] = await db
		.select({ title: episodeTitle, seriesTitle: series.title })
		.from(episode)
		.innerJoin(series, eq(series.id, episode.seriesId))
		.where(and(eq(episode.id, id), eq(episode.status, 'ready'), eq(episode.missing, false)));
	if (!ep) return `No hay ningún capítulo listo con id ${id}.`;
	ctx.outcome.actions.push({ kind: 'watch', episodeId: id, startSec });
	return `Abriendo «${ep.seriesTitle}: ${ep.title}» aquí${fromMinute(startSec)}.`;
}

const fromMinute = (startSec: number | null) =>
	startSec ? ` desde el minuto ${Math.round(startSec / 60)}` : '';

/** What the living room's actions answered, in words: they fail as a form action does. */
const played = (
	result: { playing: string } | { data: { message: string } },
	startSec: number | null
) =>
	'playing' in result
		? `Poniendo «${result.playing}» en el salón${fromMinute(startSec)}.`
		: `No se pudo: ${result.data.message}`;

/** What a satellite cannot play itself (#223), done in the whole house: an episode, its audio. */
const HOUSE_FROM_SATELLITE = new Set([
	'play_music',
	'play_radio',
	'control',
	'stop_later',
	'play_video'
]);

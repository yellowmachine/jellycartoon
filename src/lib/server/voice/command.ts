import { and, eq } from 'drizzle-orm';
import { voiceModel } from '#lib/server/app-settings.ts';
import { searchVideo, seriesEpisodes } from '#lib/server/voice/video.ts';
import { MAX_CLIP_MINUTES, sendClip } from '#lib/server/langua.ts';
import { playEpisodes, seriesQueue } from '#lib/server/cinema/episode-actions.ts';
import { playFilm } from '#lib/server/cinema/film-actions.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, series } from '#lib/server/db/schema.ts';
import { getAlbums, tracksById } from '#lib/server/music/albums.ts';
import { getPlaylist, listPlaylists } from '#lib/server/music/playlists.ts';
import {
	controlSnapcast,
	queueOnSnapcast,
	radioOnSnapcast,
	snapcastNow,
	snapcastReady
} from '#lib/server/music/snapcast.ts';
import { chatWithTools, type Tool, type ToolChatMessage } from '#lib/server/openrouter.ts';
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
import { fold, masterVolume, type MusicAlbum, type MusicTrack } from '#lib/music.ts';
import { COUNTRIES, STATIONS } from '#lib/radio.ts';
import {
	MAX_TIMER_SEC,
	type VoiceAction,
	type VoiceControl,
	type VoiceOption,
	type VoiceReply,
	type VoiceRequest,
	type VoiceTarget,
	type VideoHere
} from '#lib/voice.ts';

/**
 * Voice commands (#33): what was said, to a model with the app's actions as tools. It searches the
 * music, plays it here (the device, which does it itself) or in the whole house (Snapcast, done
 * here), answers about what the person watched (only their own, see watch-history.ts), finds and plays
 * an episode here or an episode or film in the living room (video.ts), and says it in a sentence to be read aloud.
 */

/**
 * Turns with the model before giving up: a search, an action and the answer are three; an episode
 * by its series and season, five.
 */
const MAX_ROUNDS = 7;
/** With more albums than this, the instructions list only the artists, and it searches the rest. */
const LISTED_ALBUMS = 400;
/** «Más alto» and «más bajo», on the 0–100 of Snapcast's master volume. */
const VOLUME_STEP = 15;

/** Whatever happens, the model is told in words: it explains it better than an error code. */
type ToolResult = string;

/** What the tools collect for the answer, as they run. */
interface Outcome {
	actions: VoiceAction[];
	options: VoiceOption[];
	/** `ask` was called: the answer is the question, and nothing more is done. */
	asked: string | null;
}

const targets = (house: boolean): VoiceTarget[] => (house ? ['here', 'house'] : ['here']);

function tools(house: boolean): Tool[] {
	const where = {
		type: 'string',
		enum: targets(house),
		description: house
			? '«here»: el dispositivo desde el que se habla (por defecto). «house»: toda la casa (Snapcast).'
			: '«here»: el dispositivo desde el que se habla.'
	};
	const fn = (name: string, description: string, properties: object, required: string[]) =>
		({
			type: 'function',
			function: {
				name,
				description,
				parameters: { type: 'object', properties, required, additionalProperties: false }
			}
		}) satisfies Tool;
	return [
		fn(
			'search_music',
			'Busca en la música por palabras, sin importar acentos ni mayúsculas: artistas, álbumes, listas y canciones. Para lo que no esté en la biblioteca de las instrucciones, o para encontrar una canción.',
			{ query: { type: 'string', description: 'Palabras del artista, álbum, lista o canción.' } },
			['query']
		),
		fn(
			'play_music',
			'Pone música, en lugar de lo que sonara en ese sitio.',
			{
				kind: { type: 'string', enum: ['artist', 'album', 'playlist', 'track'] },
				id: {
					type: 'string',
					description:
						'El id del álbum, la lista o la canción (el número); para un artista, su nombre tal como aparece.'
				},
				where,
				shuffle: {
					type: 'boolean',
					description: 'En orden aleatorio. Por defecto, sí para un artista y no para lo demás.'
				}
			},
			['kind', 'id', 'where']
		),
		fn(
			'play_radio',
			'Pone una emisora de radio de la lista de las instrucciones.',
			{ id: { type: 'string', description: 'El id de la emisora.' }, where },
			['id', 'where']
		),
		fn(
			'control',
			'Pausa, sigue, pasa a la siguiente o la anterior, o para lo que suena en un sitio.',
			{
				action: { type: 'string', enum: ['pause', 'resume', 'next', 'previous', 'stop'] },
				where
			},
			['action', 'where']
		),
		...(house
			? [
					fn(
						'set_volume',
						'Cambia el volumen de toda la casa (Snapcast). El del dispositivo se cambia con sus botones.',
						{
							change: { type: 'string', enum: ['up', 'down', 'set'] },
							value: { type: 'number', description: 'De 0 a 100, solo con «set».' }
						},
						['change']
					)
				]
			: []),
		fn(
			'send_clip',
			`Manda a Langua (su app de idiomas) el audio de los últimos minutos del capítulo o la película que está viendo, con lo que se dice (los subtítulos). No sirve para la radio ni los canales en directo, ni para la música.`,
			{
				minutes: {
					type: 'number',
					description: `Cuántos minutos hacia atrás, hasta ${MAX_CLIP_MINUTES}; 0.5 son 30 segundos.`
				},
				language: {
					type: 'string',
					description:
						'El idioma del audio, ISO 639-2 («eng», «spa»…), solo si lo pide; si no, el de sus ajustes.'
				}
			},
			['minutes']
		),
		fn(
			'search_video',
			'Busca series y películas por el título (también el original de las películas). Da sus ids y si cada película está vista o a medias. Busca por cómo suena: el reconocimiento de voz escribe mal los nombres.',
			{ query: { type: 'string', description: 'El título, o parte, p. ej. «friends».' } },
			['query']
		),
		fn(
			'series_episodes',
			'Las temporadas de una serie, con cuántos capítulos tiene cada una y cuántos ha visto; con «season», los capítulos de esa temporada, con sus ids y si los ha visto o los tiene a medias.',
			{
				series_id: { type: 'integer', description: 'De «search_video».' },
				season: { type: 'integer' }
			},
			['series_id']
		),
		fn(
			'play_video',
			`Pone un capítulo o una película. El id sale de «search_video», «series_episodes» o las herramientas de lo visto («[episodio 12]», «[película 3]»). ${mpvEnabled ? 'Los capítulos, aquí (en el navegador del dispositivo) o en el salón (la tele); las películas, solo en el salón.' : 'Solo capítulos, aquí (en el navegador del dispositivo): no hay salón.'}`,
			{
				kind: { type: 'string', enum: ['episode', 'film'] },
				id: { type: 'integer' },
				start_minute: {
					type: 'number',
					description: 'Desde qué minuto; 0 es desde el principio. Sin él, sigue donde lo dejó.'
				},
				where: {
					type: 'string',
					enum: mpvEnabled ? ['here', 'salon'] : ['here'],
					description: '«here»: el dispositivo desde el que se habla. «salon»: la tele del salón.'
				}
			},
			['kind', 'id', 'where']
		),
		fn(
			'set_timer',
			'Pone un temporizador en el dispositivo desde el que se habla: al acabar suena hasta que lo paren. Uno con el mismo nombre empieza de nuevo con el tiempo nuevo.',
			{
				minutes: {
					type: 'number',
					description: 'Cuántos minutos; 0.5 son 30 segundos, 90 es hora y media.'
				},
				label: {
					type: 'string',
					description:
						'Para qué es, corto y como lo diría: «la pasta», «el horno». Vacío si no lo dice.'
				}
			},
			['minutes']
		),
		fn(
			'cancel_timer',
			'Quita un temporizador de este dispositivo por su nombre, o todos; también para el que está sonando.',
			{
				label: {
					type: 'string',
					description: 'El nombre de la lista de temporizadores; vacío: todos.'
				}
			},
			[]
		),
		fn(
			'ask',
			'Cuando no está claro qué se pide entre unas pocas opciones: pregunta, y cada opción es un botón. No se hace nada más.',
			{
				question: { type: 'string', description: 'Corta, para leerla en voz alta.' },
				options: {
					type: 'array',
					maxItems: 4,
					items: {
						type: 'object',
						properties: {
							label: { type: 'string', description: 'Lo que pone el botón, corto.' },
							command: {
								type: 'string',
								description:
									'La orden completa que se manda al pulsarlo, p. ej. «Pon el álbum Deseo carnal aquí».'
							}
						},
						required: ['label', 'command'],
						additionalProperties: false
					}
				}
			},
			['question', 'options']
		)
	];
}

/**
 * What the model knows before calling anything: how to answer, the library and the stations. The
 * same from one command to the next, so that it is cached; what sounds now goes with each command.
 */
function instructions(context: {
	albums: MusicAlbum[];
	playlists: { id: number; name: string; total: number }[];
	house: boolean;
	/** Since when what they watch has hours; null: only days, or nothing. */
	hoursSince: string | null;
	/** «Guardar lo que veo», in Ajustes. */
	keepHistory: boolean;
}) {
	const { albums, playlists, house, hoursSince, keepHistory } = context;
	const byArtist = new Map<string, MusicAlbum[]>();
	for (const a of albums) byArtist.set(a.artist, [...(byArtist.get(a.artist) ?? []), a]);
	const library =
		albums.length <= LISTED_ALBUMS
			? [...byArtist].map(
					([artist, list]) =>
						`- ${artist}: ${list.map((a) => `${a.title} [álbum ${a.id}]`).join('; ')}`
				)
			: [...byArtist.keys()].map((artist) => `- ${artist}`);

	return `Eres el asistente de voz de JellyCartoon, la app de música y vídeo de una casa. Te hablan desde el móvil, a veces una persona mayor, a veces alguien con las manos ocupadas (cocinando, por ejemplo); lo que dice viene de un reconocimiento de voz y puede traer nombres mal escritos: busca por cómo suenan.

Cómo responder:
- Trátala de tú.
- Haz lo que pide con las herramientas, sin pedir confirmación. Si se equivoca, lo dirá («no, eso no», «para»).
- Al terminar una orden, contesta en español con una sola frase corta que diga lo que has hecho y dónde, p. ej. «Pongo Alaska y Dinarama aquí». Se lee en voz alta: sin listas, emojis, ids ni formato.
- Si duda entre pocas opciones, usa «ask». Si no encuentras algo, dilo y propón lo más parecido que haya.
- Si no dice dónde, es aquí${house ? ', salvo que lo que quiere controlar solo esté sonando en toda la casa' : ''}.
- «Quita eso», «para», «más alto»…: se refiere a lo que está sonando. Con cada orden va lo que suena en cada sitio.
- Sitios: aquí (el dispositivo desde el que se habla)${house ? ' y toda la casa (Snapcast)' : '; toda la casa no está disponible'}.

Otras preguntas (de cocina, de lo que sea): si no pide nada de la app, contesta tú, como un asistente general, sin herramientas.
- Es para oírlo mientras hace otra cosa: dos o tres frases cortas como mucho, con lo esencial primero. Números y cantidades claros («doscientos gramos», «diez minutos»).
- Nada de listas, tablas ni formato. Si la respuesta es larga (una receta entera, unos pasos), da el primero o lo esencial y ofrece seguir: «¿Te digo el siguiente paso?».
- Si pregunta por algo de lo que suena (el podcast, la canción), contesta con lo que sepas sin cambiar lo que suena.
- Una pregunta no es una orden: «¿cuánto tiempo cuezo la pasta?» se contesta; «pon Más de uno» se hace.
- Si es de salud o de seguridad (alergias, algo que ha comido mal, un corte), contesta con prudencia y, si puede ser serio, dile que llame al médico o al 112.

Temporizadores («avísame en 10 minutos», «pon un temporizador de 20 minutos para el horno»): «set_timer», sin preguntar. Con cada orden va la lista de los que hay en este dispositivo.
- «¿Cuánto le queda (a la pasta)?»: contesta con esa lista, sin herramientas.
- «Quita el temporizador», «ya está», «para la alarma»: «cancel_timer»; si hay varios y no está claro cuál, usa «ask».
- Di cuánto y para qué, corto: «Te aviso en diez minutos para la pasta».

Lo que ha visto en vídeo (series, películas, canales de tele), solo de su cuenta: «watch_time», «sessions», «finished» y «halfway».
- Si pregunta por eso («¿qué capítulo de Friends vi el viernes?», «¿por dónde voy en…?»), contesta a la pregunta, corto, en vez de decir lo que has hecho.
- Si quiere volver a verlo, búscalo con esas herramientas y ponlo con «play_video». Si no dice dónde, aquí${mpvEnabled ? '; una película, en el salón' : ''}.

Langua: «manda los últimos 5 minutos a Langua», «manda a Langua», «guárdame esto para estudiar», o solo «Langua» → «send_clip», sin preguntar. Sin tiempo, 30 segundos (minutes 0.5). El reconocimiento de voz puede escribir «lengua» o «la lengua»: es Langua. Dile qué se ha mandado, corto.

Series y películas: «search_video» para encontrarlas, «series_episodes» para elegir capítulo, «play_video» para ponerlas.
- «Pon Friends»: el capítulo que tenga a medias, o el siguiente al último visto; si no ha visto ninguno, el primero.
- «Temporada 3, capítulo 7»: búscalo en esa temporada con «series_episodes».
- Si hay varias que encajan (dos películas con el mismo título, una serie y una película…), usa «ask».
${historyRules(hoursSince)}
${keepHistory ? '' : '- Tiene apagado «Guardar lo que veo» en Ajustes: lo que vea ahora no se guarda. Si pregunta y no hay datos, díselo.\n'}
Biblioteca de música (artista: álbumes):
${library.join('\n') || '(vacía)'}

Listas de reproducción:
${playlists.map((p) => `- ${p.name} [lista ${p.id}, ${p.total} canciones]`).join('\n') || '(ninguna)'}

Emisoras de radio:
${STATIONS.map((s) => `- ${s.name} [${s.uuid}]: ${s.description}, ${COUNTRIES[s.country] ?? s.country}`).join('\n')}`;
}

/** What sounds in each place now, with each command: it is not what the person said. */
/** The episode in this device's player, for the AI: «manda esto a Langua» is about it. */
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
	const inHouse = !snap?.active
		? 'nada'
		: `${snap.radio ? `la radio ${snap.radio.name}` : `«${snap.track?.title}» de ${snap.track?.artist}`}${snap.paused ? ' (en pausa)' : ''}`;
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
			// The song, and the rest of its album after it.
			const album = albums.find((a) => a.tracks.some((t) => t.id === n));
			const start = album?.tracks.findIndex((t) => t.id === n) ?? -1;
			return album && start >= 0
				? { tracks: album.tracks, start, name: album.tracks[start].title }
				: null;
		}
		default:
			return null;
	}
}

function search(query: string, albums: MusicAlbum[], playlists: { id: number; name: string }[]) {
	const words = fold(query).split(/\s+/).filter(Boolean);
	const hit = (text: string) => {
		const haystack = fold(text);
		return words.every((w) => haystack.includes(w));
	};
	const artists = [...new Set(albums.map((a) => a.artist))].filter(hit).slice(0, 10);
	const found = {
		artists,
		albums: albums
			.filter((a) => hit(`${a.title} ${a.artist}`))
			.slice(0, 10)
			.map((a) => ({ id: a.id, title: a.title, artist: a.artist })),
		playlists: playlists.filter((p) => hit(p.name)).slice(0, 10),
		tracks: albums
			.flatMap((a) => a.tracks)
			.filter((t) => hit(`${t.title} ${t.artist}`))
			.slice(0, 15)
			.map((t: MusicTrack) => ({ id: t.id, title: t.title, artist: t.artist, album: t.album }))
	};
	const total =
		found.artists.length + found.albums.length + found.playlists.length + found.tracks.length;
	return total ? JSON.stringify(found) : `Nada con «${query}». Prueba con otras palabras.`;
}

async function playHouse(tracks: MusicTrack[], start: number, shuffle: boolean) {
	await controlSnapcast({ action: 'shuffle', value: shuffle });
	const found = await tracksById(tracks.map((t) => t.id));
	await queueOnSnapcast(found, {
		replace: true,
		start: shuffle ? Math.floor(Math.random() * found.length) : start
	});
}

async function controlHouse(action: VoiceControl) {
	if (action === 'pause' || action === 'resume')
		return controlSnapcast({ action: 'pause', value: action === 'pause' });
	return controlSnapcast({ action });
}

/** Runs one call of the model; what the device must do and the options, into `outcome`. */
/** An episode here (the device opens its player) or in the living room; a film, only there. */
async function playVideo(args: Record<string, unknown>, ctx: { outcome: Outcome; user: Person }) {
	const id = Number(args.id);
	if (!Number.isInteger(id)) return 'Falta el id del capítulo o la película.';
	const minute = Number(args.start_minute);
	const startSec =
		args.start_minute === undefined || !Number.isFinite(minute)
			? null
			: Math.max(0, Math.round(minute * 60));
	const salon = args.where === 'salon';
	if (salon && !mpvEnabled) return 'No hay salón (mpv) configurado.';

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

async function runTool(
	name: string,
	args: Record<string, unknown>,
	ctx: {
		albums: MusicAlbum[];
		playlists: { id: number; name: string }[];
		house: boolean;
		outcome: Outcome;
		user: Person;
		video: VideoHere | null;
	}
): Promise<ToolResult> {
	if (HISTORY_TOOLS.has(name)) return runHistoryTool(name, args, { self: ctx.user });
	const where = args.where === 'house' && ctx.house ? 'house' : 'here';
	if (args.where === 'house' && !ctx.house) return 'Toda la casa (Snapcast) no está disponible.';
	switch (name) {
		case 'search_music':
			return typeof args.query === 'string' && args.query.trim()
				? search(args.query, ctx.albums, ctx.playlists)
				: 'Falta qué buscar.';
		case 'play_music': {
			const music = await resolveMusic(String(args.kind), String(args.id ?? ''), ctx.albums);
			if (!music) return `No hay ${args.kind} con id «${args.id}». Búscalo con search_music.`;
			const shuffle = typeof args.shuffle === 'boolean' ? args.shuffle : args.kind === 'artist';
			if (where === 'house') await playHouse(music.tracks, music.start, shuffle);
			else ctx.outcome.actions.push({ kind: 'play', ...music, shuffle });
			return `Sonando «${music.name}» (${music.tracks.length} canciones) en ${where === 'house' ? 'toda la casa' : 'el dispositivo'}.`;
		}
		case 'play_radio': {
			const station = STATIONS.find((s) => s.uuid === args.id);
			if (!station) return `No hay emisora con id «${args.id}».`;
			if (where === 'house') {
				const stream = await streamFor(station.uuid);
				if (!stream) return `${station.name} no está disponible ahora.`;
				await radioOnSnapcast(stream);
			} else ctx.outcome.actions.push({ kind: 'radio', uuid: station.uuid });
			return `Sonando ${station.name} en ${where === 'house' ? 'toda la casa' : 'el dispositivo'}.`;
		}
		case 'control': {
			const action = args.action as VoiceControl;
			if (!['pause', 'resume', 'next', 'previous', 'stop'].includes(action))
				return `Acción no válida: «${args.action}».`;
			if (where === 'house') await controlHouse(action);
			else ctx.outcome.actions.push({ kind: 'control', action });
			return 'Hecho.';
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
			return playVideo(args, ctx);
		case 'set_timer': {
			const minutes = Number(args.minutes);
			if (!Number.isFinite(minutes) || minutes <= 0) return 'Falta cuántos minutos.';
			const seconds = Math.round(Math.min(minutes * 60, MAX_TIMER_SEC));
			const label = typeof args.label === 'string' ? args.label.trim().slice(0, 60) : '';
			ctx.outcome.actions.push({ kind: 'timer', label, seconds });
			return `Temporizador${label ? ` «${label}»` : ''} de ${seconds} segundos puesto en el dispositivo.`;
		}
		case 'cancel_timer': {
			const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim() : null;
			ctx.outcome.actions.push({ kind: 'cancelTimer', label });
			return label ? `Quitado el temporizador «${label}».` : 'Quitados todos los temporizadores.';
		}
		case 'ask': {
			const options = (Array.isArray(args.options) ? args.options : [])
				.filter(
					(o): o is VoiceOption => typeof o?.label === 'string' && typeof o?.command === 'string'
				)
				.slice(0, 4);
			ctx.outcome.options = options;
			ctx.outcome.asked = typeof args.question === 'string' ? args.question : '¿Cuál?';
			return 'Pregunta hecha: no hagas nada más.';
		}
		default:
			return `No existe la herramienta «${name}».`;
	}
}

/**
 * What was said, done: what the device must do, and the sentence to read aloud. `user`: who speaks,
 * from the session; an adult, a child's account has no voice.
 */
export async function runVoiceCommand(request: VoiceRequest, user: Person): Promise<VoiceReply> {
	const [albums, playlists, model, { hoursSince }, keepHistory, watchingHere] = await Promise.all([
		getAlbums(),
		listPlaylists(),
		voiceModel(),
		historySince([user]),
		keepsHistory(user.id),
		videoText(request.video)
	]);
	const house = snapcastReady();
	const outcome: Outcome = { actions: [], options: [], asked: null };
	const messages: ToolChatMessage[] = [
		{
			role: 'system',
			content: [
				{
					type: 'text',
					text: instructions({ albums, playlists, house, hoursSince, keepHistory }),
					cache_control: { type: 'ephemeral' }
				}
			]
		},
		...request.history,
		{
			role: 'user',
			content: [
				{ type: 'text', text: `[${todayText()}]` },
				{ type: 'text', text: soundingNow(request.here, house) },
				{
					type: 'text',
					text: `[Temporizadores aquí: ${request.timers.length ? request.timers.join('; ') : 'ninguno'}.]`
				},
				...(watchingHere ? [{ type: 'text' as const, text: watchingHere }] : []),
				{ type: 'text', text: request.text }
			]
		}
	];
	const available = [...tools(house), ...historyTools({ self: user })];

	for (let round = 0; round < MAX_ROUNDS; round++) {
		const answer = await chatWithTools({
			model,
			messages,
			tools: available,
			label: `Voz: «${request.text}»`,
			details: { round }
		});
		if (!answer.toolCalls.length) {
			return reply(answer.content ?? 'Hecho.', outcome);
		}
		messages.push({ role: 'assistant', content: answer.content, tool_calls: answer.toolCalls });
		for (const call of answer.toolCalls) {
			let result: ToolResult;
			try {
				const args = JSON.parse(call.function.arguments || '{}');
				result = await runTool(call.function.name, args, {
					albums,
					playlists,
					house,
					outcome,
					user,
					video: request.video
				});
			} catch (err) {
				result = `Error: ${err instanceof Error ? err.message : String(err)}`;
			}
			messages.push({ role: 'tool', tool_call_id: call.id, content: result });
		}
		if (outcome.asked) return reply(outcome.asked, outcome);
	}
	return reply(
		outcome.actions.length ? 'Hecho.' : 'No he sabido hacerlo. Prueba a decirlo de otra forma.',
		outcome
	);
}

const reply = (text: string, outcome: Outcome): VoiceReply => ({
	reply: text.trim(),
	actions: outcome.actions,
	options: outcome.options
});

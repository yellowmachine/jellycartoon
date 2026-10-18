import { voiceModel } from '#lib/server/app-settings.ts';
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
import type {
	VoiceAction,
	VoiceControl,
	VoiceOption,
	VoiceReply,
	VoiceRequest,
	VoiceTarget
} from '#lib/voice.ts';

/**
 * Voice commands (#33): what was said, to a model with the app's actions as tools. It searches the
 * music, plays it here (the device, which does it itself) or in the whole house (Snapcast, done
 * here), answers about what the person watched (only their own, see watch-history.ts), and says it
 * in a sentence to be read aloud.
 */

/** Turns with the model before giving up: a search, an action and the answer are three. */
const MAX_ROUNDS = 5;
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

	return `Eres el asistente de voz de JellyCartoon, la app de música y vídeo de una casa. Te habla una persona mayor desde el móvil; lo que dice viene de un reconocimiento de voz y puede traer nombres mal escritos: busca por cómo suenan.

Cómo responder:
- Trátala de tú.
- Haz lo que pide con las herramientas, sin pedir confirmación. Si se equivoca, lo dirá («no, eso no», «para»).
- Al terminar, contesta en español con una sola frase corta que diga lo que has hecho y dónde, p. ej. «Pongo Alaska y Dinarama aquí». Se lee en voz alta: sin listas, emojis, ids ni formato.
- Si duda entre pocas opciones, usa «ask». Si no encuentras algo, dilo y propón lo más parecido que haya.
- Si no dice dónde, es aquí${house ? ', salvo que lo que quiere controlar solo esté sonando en toda la casa' : ''}.
- «Quita eso», «para», «más alto»…: se refiere a lo que está sonando. Con cada orden va lo que suena en cada sitio.
- Sitios: aquí (el dispositivo desde el que se habla)${house ? ' y toda la casa (Snapcast)' : '; toda la casa no está disponible'}.

Lo que ha visto en vídeo (series, películas, canales de tele), solo de su cuenta: «watch_time», «sessions», «finished» y «halfway».
- Si pregunta por eso («¿qué capítulo de Friends vi el viernes?», «¿por dónde voy en…?»), contesta a la pregunta, corto, en vez de decir lo que has hecho.
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
async function runTool(
	name: string,
	args: Record<string, unknown>,
	ctx: {
		albums: MusicAlbum[];
		playlists: { id: number; name: string }[];
		house: boolean;
		outcome: Outcome;
		user: Person;
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
	const [albums, playlists, model, { hoursSince }, keepHistory] = await Promise.all([
		getAlbums(),
		listPlaylists(),
		voiceModel(),
		historySince([user]),
		keepsHistory(user.id)
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
					user
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

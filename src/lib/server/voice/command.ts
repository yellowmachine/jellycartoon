import { randomUUID } from 'node:crypto';
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
import {
	fold,
	masterVolume,
	type MusicAlbum,
	type MusicTrack,
	type SnapcastWhere
} from '#lib/music.ts';
import { COUNTRIES, STATIONS } from '#lib/radio.ts';
import { parseRecipe } from '#lib/recipe.ts';
import type { LngLat } from '#lib/road.ts';
import { searchPlaces, whereIs } from '#lib/server/road/ors.ts';
import { listSavedPlaces, listSavedRoutes } from '#lib/server/saved-places.ts';
import { asksForRoute, findByName } from '#lib/saved-places.ts';
import { addItems, addNote, tickOffByName, toBuy } from '#lib/server/fridge.ts';
import { addExpense } from '#lib/server/expenses/expenses.ts';
import { addEvent, dayForVoice, personByName } from '#lib/server/agenda/agenda.ts';
import {
	addDays,
	dayName,
	isDay,
	isTime,
	localDay,
	localTime,
	parseEventInput
} from '#lib/agenda.ts';
import { daysName, parseAlarmInput, type AlarmPlace } from '#lib/alarms.ts';
import {
	addAlarm,
	canTouch,
	cancelTimersAt,
	deleteAlarm,
	describeAlarms,
	prepareTimerAt,
	setPaused,
	skipNext,
	startTimerAt,
	stopAlarm
} from '#lib/server/alarms/alarms.ts';
import type { Satellite } from '#lib/server/satellites.ts';
import {
	runTelegramTool,
	TELEGRAM_TOOLS,
	telegramTools
} from '#lib/server/voice/telegram-tools.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import { EXPENSE_CATEGORIES, euros, isCategory } from '#lib/expenses.ts';
import { today } from '#lib/server/playlist.ts';
import { isUntilWord, UNTIL_WORDS, untilDay, untilText } from '#lib/fridge.ts';
import { getRecipe, importRecipe, listRecipes } from '#lib/server/recipes/import.ts';
import { findPlaces, forecast, housePlace, placeName } from '#lib/server/weather.ts';
import { isFavouritePage, listRecipeSites, searchRecipeSites } from '#lib/server/recipes/sites.ts';
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
/**
 * Tools whose result tells the model nothing new when they do what they were asked (they leave
 * the device something to do). They take the answer too (`say`): with only these, it is read
 * without a second turn with the model (about a second less). Asked in the instructions instead,
 * the model wrote it only sometimes.
 */
/** «Para dentro de…»: at most a night. */
const MAX_STOP_LATER_MIN = 12 * 60;

const ONE_ROUND = new Set([
	'set_timer',
	'prepare_timer',
	'cancel_timer',
	'kitchen_mode',
	'control',
	'stop_later',
	'take_photo',
	'stop_navigation',
	'recipe_step',
	'end_recipe'
]);
const SAY = {
	type: 'string',
	description:
		'La frase de respuesta, que se lee en voz alta si sale bien, p. ej. «Pongo un temporizador de un minuto».'
};
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
	/** Done here, by the server, as an action for the device would be: a satellite's timer (#241). */
	done: number;
}

/** A speaker of the house (Snapcast), by its name: only there (#223). */
interface Room {
	id: string;
	name: string;
}

/** Their names, but those of the other places: «here», «house», and for videos «salon» (the TV). */
const roomNames = (rooms: Room[], taken: string[]) =>
	[...new Set(rooms.map((r) => r.name))].filter((n) => !taken.includes(fold(n)));

const targets = (house: boolean, rooms: Room[]): string[] =>
	house
		? ['here', 'house', ...roomNames(rooms, ['here', 'house'])]
		: (['here'] satisfies VoiceTarget[]);

const ROOMS =
	' O el nombre de un altavoz de la casa: solo ahí, y los demás callan (p. ej. «en el dormitorio»).';

function tools(house: boolean, rooms: Room[]): Tool[] {
	const where = {
		type: 'string',
		enum: targets(house, rooms),
		description: house
			? `«here»: el dispositivo desde el que se habla (por defecto). «house»: toda la casa (Snapcast).${rooms.length ? ROOMS : ''}`
			: '«here»: el dispositivo desde el que se habla.'
	};
	const fn = (name: string, description: string, properties: object, required: string[]) =>
		({
			type: 'function',
			function: {
				name,
				description,
				parameters: {
					type: 'object',
					properties: ONE_ROUND.has(name) ? { ...properties, say: SAY } : properties,
					required: ONE_ROUND.has(name) ? [...required, 'say'] : required,
					additionalProperties: false
				}
			}
		}) satisfies Tool;
	return [
		fn(
			'search_music',
			'Busca en la música por palabras, sin importar acentos ni mayúsculas: artistas, álbumes, listas y canciones. Para lo que no esté en la biblioteca de las instrucciones, o para encontrar una canción. Si no hay nada con todas las palabras, da lo que más se parece por cómo suena: si una de esas encaja con lo que pidió, ponla sin volver a buscar.',
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
				action: {
					type: 'string',
					enum: ['pause', 'resume', 'next', 'previous', 'stop', 'stopAfterTrack'],
					description:
						'«stopAfterTrack»: para al acabar la canción que suena («cuando acabe esta»).'
				},
				where
			},
			['action', 'where']
		),
		fn(
			'stop_later',
			'Para la música dentro de unos minutos («apaga la música en media hora», «para dentro de una hora»), al acabar la canción que suene entonces. 0 quita lo puesto.',
			{
				minutes: { type: 'number', description: `De 0 a ${MAX_STOP_LATER_MIN}.` },
				where
			},
			['minutes', 'where']
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
			'get_weather',
			'El tiempo: ahora, los próximos siete días, y hoy y mañana por horas. Sin «place», donde está la casa (en el coche, donde está).',
			{
				place: {
					type: 'string',
					description: 'Otro pueblo o ciudad, si lo dice: «Toledo», «Benidorm». Vacío: aquí.'
				}
			},
			[]
		),
		fn(
			'navigate_to',
			'Modo carretera: traza la ruta en coche desde donde está hasta un sitio, en el mapa, con los pasos y su voz. «Llévame a…», «vamos a…», «¿cómo llego a…?». También sus sitios y rutas guardados, por su nombre: «llévame a casa», «la ruta del trabajo».',
			{
				destination: {
					type: 'string',
					description:
						'El sitio, como se diría a un navegador: «Plaza de Zocodover, Toledo», «Calle Mayor 5, Madrid». Uno de sus sitios o rutas guardados, tal cual lo dice: «casa», «ruta del trabajo».'
				}
			},
			['destination']
		),
		fn(
			'where_am_i',
			'Modo carretera: la dirección de donde está ahora, por su GPS. «¿Dónde estoy?», «¿por dónde vamos?».',
			{},
			[]
		),
		fn(
			'take_photo',
			'Modo carretera: hace una foto con la cámara de la tablet, hacia la carretera, y la guarda con dónde y cuándo. «Haz una foto», «foto», «guarda esto».',
			{},
			[]
		),
		fn(
			'stop_navigation',
			'Modo carretera: quita la ruta que hay. «Quita la ruta», «ya no hace falta», «cancela la navegación».',
			{},
			[]
		),
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
					enum: [
						'here',
						...(mpvEnabled ? ['salon'] : []),
						...(house ? ['house', ...roomNames(rooms, ['here', 'house', 'salon'])] : [])
					],
					description: `«here»: el dispositivo desde el que se habla. ${mpvEnabled ? '«salon»: la tele del salón. ' : ''}${house ? `Solo el audio de un capítulo, sin imagen (para oírlo o dormirse con él): «house», toda la casa (Snapcast).${rooms.length ? ROOMS : ''}` : ''}`
				}
			},
			['kind', 'id', 'where']
		),
		fn(
			'add_to_shopping_list',
			'Añade cosas a la lista de la compra de la casa (la de la nevera, que ven todos). «Añade leche y pan», «apunta huevos», «que no se nos olvide el detergente». A los demás les llega un aviso.',
			{
				items: {
					type: 'array',
					items: { type: 'string' },
					description: 'Cada cosa por separado, corta y en minúscula: ["leche", "pan"].'
				}
			},
			['items']
		),
		fn(
			'shopping_list',
			'Lo que queda por comprar en la lista de la compra de la casa. «¿Qué hay en la lista?», «¿qué falta por comprar?».',
			{},
			[]
		),
		fn(
			'tick_off_shopping',
			'Tacha algo de la lista de la compra: ya comprado, o ya no hace falta. «Ya tengo la leche», «quita el pan de la lista».',
			{ item: { type: 'string', description: 'Lo que se tacha, como está en la lista.' } },
			['item']
		),
		fn(
			'add_expense',
			'Apunta un gasto en los gastos de la casa (#194), que ven todos los adultos. «He gastado 40 euros en gasolina», «apunta 12,50 de la farmacia», «la cena ha sido 63 euros».',
			{
				amount: { type: 'number', description: 'Lo gastado, en euros: 12.5.' },
				what: {
					type: 'string',
					description:
						'Dónde o en qué, corto y con mayúscula, como se apuntaría: «Gasolina», «Farmacia», «Cena».'
				},
				category: {
					type: 'string',
					enum: [...EXPENSE_CATEGORIES],
					description: 'La categoría que mejor le va; Restaurantes es también bares y cafeterías.'
				}
			},
			['amount', 'what', 'category']
		),
		fn(
			'add_event',
			'Apunta algo en la agenda de la casa (#200), que ven todos; lo de hoy sale en la nevera y en la tele. «Apunta el dentista de Lucía el jueves a las cinco», «el cumpleaños de Pablo es el 3 de marzo», «inglés los martes y jueves a las seis».',
			{
				title: {
					type: 'string',
					description: 'Qué es, corto y con mayúscula: «Dentista», «Cumpleaños de Pablo», «Inglés».'
				},
				day: {
					type: 'string',
					description: 'El día, YYYY-MM-DD, calculado desde hoy; si se repite, el primero.'
				},
				time: {
					type: 'string',
					description:
						'La hora, HH:MM en 24 horas («a las cinco» de la tarde: 17:00). Sin ella, todo el día.'
				},
				people: {
					type: 'array',
					items: { type: 'string' },
					description: 'Para quién es, por su nombre, si lo dicen; también los peques.'
				},
				repeat: {
					type: 'string',
					enum: ['no', 'semana', 'mes', 'año'],
					description: 'Si se repite: cada semana, cada mes o cada año (los cumpleaños).'
				},
				weekdays: {
					type: 'array',
					items: { type: 'integer' },
					description: 'Con «semana», qué días: 0 lunes … 6 domingo.'
				},
				remind: {
					type: 'string',
					enum: ['no', 'hora', 'dia'],
					description: 'Aviso al móvil, solo si lo piden: una hora antes, o el día antes.'
				}
			},
			['title', 'day']
		),
		fn(
			'agenda',
			'Lo que hay apuntado en la agenda de la casa, día a día: «¿qué tenemos mañana?», «¿qué hay esta semana?», «¿cuándo es el dentista?».',
			{
				from: { type: 'string', description: 'El primer día, YYYY-MM-DD.' },
				to: {
					type: 'string',
					description: 'El último día, YYYY-MM-DD; como mucho, 31 días después.'
				}
			},
			['from']
		),
		fn(
			'add_fridge_note',
			'Pega un post-it en la nevera de la casa, para que lo vean los demás (también en la tele del salón; les llega un aviso). «Deja un post-it: llamar al fontanero», «avisa a todos de que la cena está en el horno». Para cosas que comprar, add_to_shopping_list.',
			{
				text: {
					type: 'string',
					description: 'Lo que dice el post-it, corto y como lo diría la persona.'
				},
				until: {
					type: 'string',
					enum: [...UNTIL_WORDS],
					description:
						'Hasta cuándo se queda puesto, si lo dice («hasta el viernes»). Sin él, hasta que alguien lo quite.'
				}
			},
			['text']
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
						'Para qué es, corto y como lo diría: «la pasta», «el horno». Vacío si no lo dice, aunque ya haya otro del mismo tiempo: se llamará por su tiempo, «5 minutos», o «5 minutos (2)». El nombre de uno de la lista solo para volver a empezar ese.'
				}
			},
			['minutes']
		),
		fn(
			'prepare_timer',
			'Deja preparado un temporizador que arrancará cuando pase algo que dirá luego («cuando hierva», «cuando esté hecho el sofrito»). No arranca ahora: sale en la lista de temporizadores como preparado.',
			{
				minutes: { type: 'number', description: 'Cuántos minutos durará cuando arranque.' },
				label: {
					type: 'string',
					description:
						'Para qué es, corto: «la pasta», «el arroz». Si no lo dice, lo que se va a cocinar.'
				},
				trigger: {
					type: 'string',
					description:
						'Lo que espera, para completar «arranca cuando…»: «hierva el agua», «esté hecho el sofrito».'
				}
			},
			['minutes', 'label', 'trigger']
		),
		fn(
			'kitchen_mode',
			'Enciende o apaga el modo cocina en el dispositivo desde el que se habla: la pantalla no se apaga, para el móvil en la pared de la cocina.',
			{ on: { type: 'boolean' } },
			['on']
		),
		fn(
			'cancel_timer',
			'Quita un temporizador de este dispositivo por su nombre, o todos: en marcha, preparados o el que está sonando.',
			{
				label: {
					type: 'string',
					description: 'El nombre de la lista de temporizadores; vacío: todos.'
				}
			},
			[]
		),
		fn(
			'set_alarm',
			'Pone una alarma a una hora: una vez («mañana a las 8») o los días que se repite («de lunes a viernes a las 7:30»). Suena en toda la casa o, si se habla desde un satélite, donde contesta, con un «din-don» y su nombre, hasta que la paren. Para «avísame en 10 minutos», set_timer.',
			{
				time: { type: 'string', description: 'HH:MM, en 24 horas: «07:30», «20:00».' },
				days: {
					type: 'array',
					items: { type: 'integer' },
					description:
						'Los días que se repite, 0 el lunes y 6 el domingo: todos los días [0,1,2,3,4,5,6], de lunes a viernes [0,1,2,3,4]. Vacío: una vez.'
				},
				day: {
					type: 'string',
					description:
						'Una vez: el día, AAAA-MM-DD. Vacío: hoy si aún no ha pasado esa hora, si no mañana.'
				},
				label: {
					type: 'string',
					description: 'Para qué, corto y que se entienda al oírlo: «levantarse», «la pastilla».'
				},
				for: {
					type: 'string',
					description:
						'Para quién, si lo dice: su nombre, o «casa». Vacío: de quien habla (desde un satélite, de la casa).'
				}
			},
			['time']
		),
		fn(
			'change_alarm',
			'Cambia una alarma de la lista por su número: quitarla, saltarse solo la próxima vez («mañana no»), pausarla, activarla o pararla si está sonando.',
			{
				id: { type: 'integer', description: 'El número de la alarma, de la lista.' },
				do: { type: 'string', enum: ['delete', 'skip', 'pause', 'resume', 'stop'] }
			},
			['id', 'do']
		),
		fn(
			'start_recipe',
			'Pone en este dispositivo la receta que se va a cocinar ahora, entera, en lugar de la que hubiera: se ve en la pantalla de la cocina y va con cada orden, con el paso por el que va.',
			{
				title: { type: 'string', description: 'El plato: «Espaguetis a la carbonara».' },
				servings: { type: 'integer', description: 'Para cuántas personas.' },
				ingredients: {
					type: 'array',
					items: { type: 'string' },
					description: 'Cada uno con su cantidad: «400 g de espaguetis».'
				},
				steps: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							text: {
								type: 'string',
								description:
									'Una o dos frases cortas, para oírlas: «Echa los espaguetis y remueve». Con temporizador, también lo que se hace mientras.'
							},
							timer_minutes: {
								type: 'number',
								description: 'Si el paso es esperar un tiempo: cuántos minutos.'
							},
							timer_label: {
								type: 'string',
								description: 'El nombre de ese temporizador, corto: «la pasta», «el horno».'
							},
							timer_trigger: {
								type: 'string',
								description:
									'Si el tiempo empieza con algo que hará o pasará luego, para completar «arranca cuando…»: «eches la pasta». Vacío si empieza con el paso.'
							}
						},
						required: ['text'],
						additionalProperties: false
					}
				},
				step: {
					type: 'integer',
					description:
						'Por qué paso va, desde 1. Solo al reescribir la receta a mitad (otro ingrediente, otras personas); si no, la primera.'
				}
			},
			['title', 'ingredients', 'steps']
		),
		fn(
			'cook_saved_recipe',
			'Pone en este dispositivo una receta del recetario de la casa, desde el primer paso, como «start_recipe».',
			{ id: { type: 'integer', description: 'El número de la receta en el recetario.' } },
			['id']
		),
		fn(
			'search_recipe_sites',
			'Busca recetas en las webs favoritas por las palabras de su dirección: devuelve título, web y dirección de cada una.',
			{
				query: { type: 'string', description: 'El plato: «macarrones gratinados».' },
				site: { type: 'integer', description: 'Solo en esa web (su número); sin él, en todas.' }
			},
			['query']
		),
		fn(
			'cook_from_web',
			'Guarda en el recetario una receta de una web favorita (una dirección de «search_recipe_sites») y la pone en este dispositivo, desde el primer paso. Tarda unos segundos.',
			{ url: { type: 'string', description: 'Su dirección, tal cual.' } },
			['url']
		),
		fn(
			'recipe_step',
			'Lleva la receta en marcha a un paso: el siguiente cuando ha hecho el de ahora, o el que diga («vuelve al anterior»).',
			{ step: { type: 'integer', description: 'El número del paso, desde 1.' } },
			['step']
		),
		fn('end_recipe', 'Quita la receta en marcha: ha terminado o ya no la quiere.', {}, []),
		fn(
			'ask',
			'Cuando no está claro qué se pide entre unas pocas opciones: pregunta, y cada opción es un botón. No se hace nada más.',
			{
				question: {
					type: 'string',
					description:
						'Corta, para leerla en voz alta, nombrando las opciones: se contesta de palabra, sin ver los botones.'
				},
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
	/** The house's recipe book. */
	recipes: { id: number; title: string; sourceName: string }[];
	/** The house's favourite cooking sites. */
	sites: { id: number; name: string; host: string }[];
}) {
	const { albums, playlists, house, hoursSince, keepHistory, recipes, sites } = context;
	const byArtist = new Map<string, MusicAlbum[]>();
	for (const a of albums) byArtist.set(a.artist, [...(byArtist.get(a.artist) ?? []), a]);
	const library =
		albums.length <= LISTED_ALBUMS
			? [...byArtist].map(
					([artist, list]) =>
						`- ${artist}: ${list.map((a) => `${a.title} [álbum ${a.id}]`).join('; ')}`
				)
			: [...byArtist.keys()].map((artist) => `- ${artist}`);

	return `Eres el asistente de voz de JellyCartoon, la app de música y vídeo de una casa. Te hablan desde el móvil, a veces una persona mayor, a veces alguien con las manos ocupadas (cocinando, por ejemplo); lo que dice viene de un reconocimiento de voz y puede traer nombres mal escritos: busca por cómo suenan. Con una tele o una radio de fondo pueden colarse frases sueltas de ella, en medio o al final: haz caso solo a lo que tiene sentido como orden o pregunta para ti e ignora lo demás.

Cómo responder:
- Trátala de tú. Con cada orden va quién habla: llámala por su nombre de pila de vez en cuando (al saludar, al despedirse, con una buena noticia), no en cada respuesta.
- Haz lo que pide con las herramientas, sin pedir confirmación. Si se equivoca, lo dirá («no, eso no», «para»).
- Al terminar una orden, contesta en español con una sola frase corta que diga lo que has hecho y dónde, p. ej. «Pongo Alaska y Dinarama aquí». Se lee en voz alta: sin listas, emojis, ids ni formato.
- Si lo encuentras con otro nombre porque se oyó mal («Boyman Rhapsody» es «Bohemian Rhapsody»), no lo expliques: di solo lo que pones, con su nombre bien («Pongo Bohemian Rhapsody de Queen en toda la casa»). Cada palabra de más se tarda en decir.
- Si duda entre pocas opciones, usa «ask», con una pregunta que las nombre («¿El álbum Deseo carnal o la canción?»): quien la oye quizá no ve los botones, y contesta de palabra. Si la orden siguiente es esa respuesta («la segunda», «el álbum», «el de Alaska»), haz la orden de la opción que elige: van en el turno de tu pregunta. Si no encuentras algo, dilo y propón lo más parecido que haya.
- Si no dice dónde, es aquí${house ? ', salvo que lo que quiere controlar solo esté sonando en toda la casa' : ''}.
- «Quita eso», «para», «más alto»…: se refiere a lo que está sonando. Con cada orden va lo que suena en cada sitio.
- Sitios: aquí (el dispositivo desde el que se habla)${house ? ' y toda la casa (Snapcast), o uno solo de sus altavoces por su nombre' : '; toda la casa no está disponible'}.

Otras preguntas (de cocina, de lo que sea): si no pide nada de la app, contesta tú, como un asistente general, sin herramientas.
- Es para oírlo mientras hace otra cosa: dos o tres frases cortas como mucho, con lo esencial primero. Números y cantidades claros («doscientos gramos», «diez minutos»).
- Nada de listas, tablas ni formato. Si la respuesta es larga (una receta entera, unos pasos), da el primero o lo esencial y ofrece seguir: «¿Te digo el siguiente paso?».
- Si pregunta por algo de lo que suena (el podcast, la canción), contesta con lo que sepas sin cambiar lo que suena.
- Una pregunta no es una orden: «¿cuánto tiempo cuezo la pasta?» se contesta; «pon Más de uno» se hace.
- Si es de salud o de seguridad (alergias, algo que ha comido mal, un corte), contesta con prudencia y, si puede ser serio, dile que llame al médico o al 112.

El tiempo («¿qué tiempo hará mañana?», «¿llueve esta tarde?», «¿hace frío para salir?»): «get_weather», sin preguntar. Contesta corto, solo lo que pregunta: el cielo, las temperaturas y, si puede llover, la probabilidad. Nunca lo inventes.

Temporizadores («avísame en 10 minutos», «pon un temporizador de 20 minutos para el horno»): «set_timer», sin preguntar. Con cada orden va la lista de los que hay en este dispositivo.
Telegram: «dile a Ana que…», «contesta a…», «manda al grupo de… que…» son mensajes de su propia cuenta: «telegram_send» y luego «ask» («¿Le mando a Ana: "llego en diez minutos"?»), y con su respuesta «telegram_confirm»; nunca lo envíes sin su sí. «Di en el grupo que…», «avisa a la familia de que…» son del bot de la casa: «group_say». Si no tienes la herramienta, dile que no está conectado.
Alarmas a una hora («despiértame a las 7», «todos los días laborables a las 7:30», «el jueves a las 9 la cita del médico»): «set_alarm». Con cada orden va la lista de alarmas, con su número: para quitar una, saltarse solo la próxima («mañana no me despiertes»), pausarla o pararla, «change_alarm» con ese número; si no está claro cuál, usa «ask».
- «¿Cuánto le queda (a la pasta)?»: contesta con esa lista, sin herramientas.
- «Otro de 5 minutos» es uno nuevo (nombre vacío), no el que ya hay de 5 minutos; «vuelve a empezar el de la pasta» sí usa su nombre.
- Haz solo lo que pide la orden de ahora: los temporizadores de órdenes anteriores ya se pusieron. Uno que ya sonó o se quitó no se vuelve a poner si no lo pide otra vez.
- «Quita el temporizador», «ya está», «para la alarma»: «cancel_timer»; si hay varios y no está claro cuál, usa «ask».
- Di cuánto y para qué, corto: «Te aviso en diez minutos para la pasta».
- «Cuando hierva, pon 8 minutos para la pasta»: «prepare_timer», uno por cada cosa que espera. Di lo que queda preparado, corto: «Vale: ocho minutos cuando hierva y media hora cuando esté el sofrito».
- «Modo cocina», «que no se apague la pantalla»: «kitchen_mode». Se apaga solo a las tres horas sin temporizadores.
- Cuando diga que ya ha pasado lo que espera uno preparado («ya hierve», «ya está el sofrito»), arráncalo con «set_timer» con su mismo nombre y sus minutos. Si no está claro cuál, usa «ask».

Recetas para cocinar ahora («vamos a hacer una carbonara», «quiero una receta de macarrones gratinados»), en este orden. Si solo pregunta cómo se hace algo, contesta sin ellas.
1. El recetario de la casa (al final): si está, ponla con «cook_saved_recipe»; si encajan varias, usa «ask».
2. Si no está y hay webs favoritas (al final), búscala en ellas con «search_recipe_sites», sin preguntar, con las palabras del plato. Si encuentra alguna, ofrece con «ask» hasta tres de las que mejor encajen, cada opción con la orden «Cocina la receta de [su dirección]», y una más, «Escríbela tú», con la orden «Escribe tú la receta de [el plato]». Con «Cocina la receta de…», «cook_from_web».
3. Si no hay nada en las webs (o no hay webs, o dice «escríbela tú»), escríbela entera con «start_recipe» y dile que no estaba en el recetario ni en sus webs.
- Si la pide de una web en concreto («una receta de macarrones de [web]»), busca solo en esa («site»; reconócela por cómo suena). Una web que no está entre las favoritas no se puede buscar: dile que la añada en Recetas.
- Para las personas que diga; si no lo dice, para dos, y díselo.
- Pasos cortos, en el orden en que se hacen, para oírlos de uno en uno. Un tiempo que esperar («cuece 9 minutos», «hornea 35») es el temporizador de su paso, con su nombre; con «timer_trigger» si empieza con algo que hará o pasará después («eches la pasta»).
- Lo que se hace mientras corre un temporizador va en el texto de ese mismo paso («Echa los espaguetis. Mientras, dora el guanciale»): al acabar, la app pasa sola al paso siguiente, que tiene que ser lo que toca entonces («Escurre la pasta…»).
- Al ponerla, contesta con los ingredientes muy resumidos y el primer paso. Si ese paso tiene temporizador, ponlo («set_timer») o déjalo preparado («prepare_timer»).
Con una receta en marcha, va con cada orden, con el paso por el que va:
- Cuando diga que ha hecho el paso o que ha pasado algo («ya hierve el agua», «ya está», «siguiente»), llévala con «recipe_step» al paso que toca y dile ese paso, corto. Si ese paso tiene temporizador y ya puede empezar a contar, ponlo con «set_timer» con su nombre y sus minutos; si espera algo, «prepare_timer». Si hay algo que hacer mientras, díselo.
- Ejemplo: va por «Pon agua a hervir» y el siguiente es «Echa los espaguetis. Mientras, dora el guanciale [temporizador «la pasta», 9 min, cuando eches la pasta]»; dice «ya está hirviendo»: «recipe_step» al siguiente, «set_timer» de 9 minutos «la pasta», y «Echa los espaguetis. Te aviso en nueve minutos; mientras, dora el guanciale».
- Al acabar un temporizador de la receta, la app ya dice sola el paso siguiente y la lleva a él.
- «¿Cuánto queso era?», «¿qué me falta?», «repítelo»: contesta con la receta, sin herramientas.
- Si no tiene algo o quiere cambiarla (otro ingrediente, más personas): propón el cambio y, si lo acepta, reescríbela con «start_recipe» con el paso por el que va.
- «Hemos terminado», «quita la receta»: «end_recipe».

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
${STATIONS.map((s) => `- ${s.name} [${s.uuid}]: ${s.description}, ${COUNTRIES[s.country] ?? s.country}`).join('\n')}

Recetario de la casa:
${recipes.map((r) => `- ${r.title} [receta ${r.id}, de ${r.sourceName}]`).join('\n') || '(vacío)'}

Webs de recetas favoritas:
${sites.map((s) => `- ${s.name} [web ${s.id}, ${s.host}]`).join('\n') || '(ninguna)'}`;
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

/** Runs one call of the model; what the device must do and the options, into `outcome`. */
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
		/** The recipe being cooked here, described; null if none. */
		recipe: string | null;
		/** Where we are, in the road mode. */
		position?: LngLat | null;
		/** Said to a voice satellite (#223), which plays nothing itself. */
		satellite: boolean;
		/** Where its timers and alarms are kept by the server (#241): a satellite's; null, a phone's. */
		place: AlarmPlace | null;
		/** The satellite's name, said to one (#243): «Desde el salón». */
		satelliteName: string | null;
		/** This order's own id: a message is never sent in the order that prepared it (#243). */
		order: string;
		rooms: Room[];
	}
): Promise<ToolResult> {
	if (HISTORY_TOOLS.has(name)) return runHistoryTool(name, args, { self: ctx.user });
	if (TELEGRAM_TOOLS.has(name))
		return runTelegramTool(name, args, {
			userId: ctx.user.id,
			userName: ctx.user.name,
			satellite: ctx.satelliteName,
			order: ctx.order
		});
	// A satellite's «aquí» has nothing to play on: music, radio and their controls, in the whole house.
	const asked =
		ctx.satellite && HOUSE_FROM_SATELLITE.has(name) && (!args.where || args.where === 'here')
			? 'house'
			: args.where;
	const room = ctx.house ? ctx.rooms.find((r) => fold(r.name) === fold(String(asked))) : undefined;
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
		case 'navigate_to': {
			const wanted = typeof args.destination === 'string' ? args.destination.trim() : '';
			if (!wanted) return 'Falta el destino.';
			// Their own first (#151): a route if one is asked for, then a place, then a route.
			const [places, routes] = await Promise.all([
				listSavedPlaces(ctx.user.id),
				listSavedRoutes(ctx.user.id)
			]);
			const savedRoute = findByName(routes, wanted);
			const savedPlace = findByName(places, wanted);
			if (savedRoute && (asksForRoute(wanted) || !savedPlace)) {
				ctx.outcome.actions.push({ kind: 'route', id: savedRoute.id });
				return `Su ruta «${savedRoute.name}», desde donde está: el mapa la traza y la va diciendo. Díselo corto.`;
			}
			if (savedPlace) {
				ctx.outcome.actions.push({
					kind: 'navigate',
					place: { label: savedPlace.name, at: savedPlace.at }
				});
				return `Ruta a ${savedPlace.name}, uno de sus sitios: el mapa la traza y la va diciendo. Díselo corto.`;
			}
			const [place] = await searchPlaces(wanted, ctx.position ?? null);
			if (!place)
				return `No encuentro «${wanted}». Pídele que lo diga de otra forma (con el pueblo o la ciudad).`;
			ctx.outcome.actions.push({ kind: 'navigate', place });
			return `Ruta a ${place.label}: el mapa la traza y la va diciendo. Díselo corto.`;
		}
		case 'where_am_i': {
			if (!ctx.position) return 'Todavía no se sabe dónde está: el GPS no ha dado la posición.';
			const label = await whereIs(ctx.position);
			return label ? `Está en ${label}.` : 'No sé qué hay en ese punto.';
		}
		case 'take_photo':
			ctx.outcome.actions.push({ kind: 'photo' });
			return 'Foto hecha. Díselo en una palabra o dos.';
		case 'stop_navigation':
			ctx.outcome.actions.push({ kind: 'navigate', place: null });
			return 'Ruta quitada.';
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
		case 'add_to_shopping_list': {
			const items = Array.isArray(args.items)
				? args.items.filter((i: unknown): i is string => typeof i === 'string')
				: [];
			if (!items.length) return 'Falta qué añadir.';
			const added = await addItems(ctx.user.id, items);
			return added.length
				? `Añadido a la lista: ${added.join(', ')}.`
				: 'Ya estaba todo en la lista.';
		}
		case 'shopping_list': {
			const left = await toBuy();
			return left.length ? `En la lista: ${left.join(', ')}.` : 'La lista de la compra está vacía.';
		}
		case 'tick_off_shopping': {
			const wanted = typeof args.item === 'string' ? args.item : '';
			// From a satellite, who is not known.
			const done = wanted ? await tickOffByName(wanted, ctx.satellite ? null : ctx.user.id) : null;
			return done ? `Tachado: ${done}.` : `«${wanted}» no está en la lista por comprar.`;
		}
		case 'add_expense': {
			if (await isKidAccount(ctx.user.id)) return 'Los gastos son cosa de los mayores.';
			const amount = Number(args.amount);
			const what = typeof args.what === 'string' ? args.what.trim().slice(0, 120) : '';
			if (!Number.isFinite(amount) || amount <= 0 || amount >= 1_000_000)
				return 'Falta cuánto, en euros.';
			if (!what) return 'Falta en qué.';
			const total = Math.round(amount * 100);
			const category = isCategory(args.category) ? args.category : 'Otros';
			await addExpense(
				ctx.user.id,
				{ date: today(), store: what, category, total, lines: [] },
				'voz'
			);
			return `Apuntado en Gastos: ${what}, ${euros(total)} (${category}).`;
		}
		case 'add_event': {
			if (await isKidAccount(ctx.user.id)) return 'La agenda la apuntan los mayores.';
			const people: string[] = [];
			const unknown: string[] = [];
			for (const name of Array.isArray(args.people) ? args.people : []) {
				const found = typeof name === 'string' ? await personByName(name) : null;
				if (found) people.push(found.id);
				else unknown.push(String(name));
			}
			const time = isTime(args.time) ? args.time : null;
			const input = parseEventInput({
				title: args.title,
				startDay: args.day,
				startTime: time,
				repeat:
					args.repeat === 'semana'
						? { every: 'semana', days: args.weekdays ?? [] }
						: args.repeat === 'mes' || args.repeat === 'año'
							? { every: args.repeat }
							: null,
				remind: args.remind,
				people
			});
			if (!input) return 'Falta qué es o el día (YYYY-MM-DD).';
			await addEvent(ctx.user.id, input);
			return [
				`Apuntado en la agenda: ${input.title}, el ${dayName(input.startDay, true)}${time ? ` a las ${time}` : ''}.`,
				unknown.length
					? `No hay nadie en casa llamado ${unknown.join(' ni ')}: no se ha puesto para quién.`
					: ''
			]
				.filter(Boolean)
				.join(' ');
		}
		case 'agenda': {
			if (!isDay(args.from)) return 'Falta desde qué día (YYYY-MM-DD).';
			const last = isDay(args.to) && args.to >= args.from ? args.to : args.from;
			const days: string[] = [];
			for (let day = args.from; day <= last && days.length < 32; day = addDays(day, 1))
				days.push(day);
			const kid = (await isKidAccount(ctx.user.id)) ? ctx.user.id : null;
			const lines = await Promise.all(
				days.map(async (day) => {
					const events = await dayForVoice(day, kid);
					return events.length ? `${dayName(day, true)}: ${events.join('; ')}` : null;
				})
			);
			const found = lines.filter(Boolean);
			return found.length ? found.join('\n') : 'Nada apuntado esos días.';
		}
		case 'add_fridge_note': {
			const text = typeof args.text === 'string' ? args.text.trim() : '';
			if (!text) return 'Falta lo que dice el post-it.';
			const until = isUntilWord(args.until) ? untilDay(args.until) : null;
			await addNote(ctx.user.id, text, until);
			return `Post-it pegado en la nevera${until ? ` (${untilText(until)})` : ''}: «${text}».`;
		}
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
		case 'kitchen_mode':
			ctx.outcome.actions.push({ kind: 'kitchenMode', on: args.on !== false });
			return args.on !== false
				? 'Modo cocina encendido: la pantalla no se apaga.'
				: 'Modo cocina apagado.';
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
		case 'set_alarm': {
			if (!isTime(args.time)) return 'Falta la hora, como HH:MM.';
			const days = Array.isArray(args.days)
				? args.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
				: [];
			let day = isDay(args.day) ? args.day : localDay();
			// Once, at a time already gone today: tomorrow.
			if (!days.length && day === localDay() && args.time <= localTime()) day = addDays(day, 1);
			const asked = typeof args.for === 'string' ? args.for.trim() : '';
			let people: string[];
			if (/^(la )?casa$/i.test(asked)) people = [];
			else if (asked) {
				const found = await personByName(asked);
				if (!found) return `No hay nadie llamado «${asked}» en la casa.`;
				people = [found.id];
			} else people = ctx.satellite ? [] : [ctx.user.id];
			const input = parseAlarmInput({
				kind: 'alarma',
				time: args.time,
				day,
				days,
				label: typeof args.label === 'string' ? args.label : '',
				people,
				place: ctx.place ?? 'casa'
			});
			if (!input || input.kind !== 'alarma') return 'Alarma no válida.';
			const id = await addAlarm(ctx.user.id, input);
			return `Alarma ${id} «${input.label}» puesta: a las ${input.time}, ${days.length ? daysName(days).toLowerCase() : `el ${dayName(day)}`}; ${people.length ? 'de una persona' : 'de la casa'}.`;
		}
		case 'change_alarm': {
			const id = Number(args.id);
			// From a satellite, only the house's; from a phone, the house's and theirs.
			const visible = ctx.satellite ? await canTouch(id, '') : await canTouch(id, ctx.user.id);
			if (!Number.isInteger(id) || !visible) return `No hay alarma ${args.id}.`;
			switch (args.do) {
				case 'delete':
					await deleteAlarm(id);
					return `Alarma ${id} quitada.`;
				case 'skip':
					await skipNext(id);
					return `La próxima de la alarma ${id} no sonará; las siguientes, sí.`;
				case 'pause':
					await setPaused(id, true);
					return `Alarma ${id} pausada.`;
				case 'resume':
					await setPaused(id, false);
					return `Alarma ${id} activada de nuevo.`;
				case 'stop':
					await stopAlarm(id);
					return `Alarma ${id} parada.`;
			}
			return 'Acción no válida.';
		}
		case 'start_recipe': {
			const recipe = parseRecipe(args);
			if (typeof recipe === 'string') return recipe;
			const step = Math.min(Math.max(Number(args.step) || 1, 1), recipe.steps.length);
			ctx.outcome.actions.push({ kind: 'recipe', recipe, step: step - 1 });
			return `Receta «${recipe.title}» en marcha en el dispositivo, en el paso ${step} de ${recipe.steps.length}.`;
		}
		case 'cook_saved_recipe': {
			const saved = await getRecipe(Number(args.id));
			if (!saved) return `No hay receta ${args.id} en el recetario.`;
			const recipe = parseRecipe(saved);
			if (typeof recipe === 'string') return recipe;
			ctx.outcome.actions.push({ kind: 'recipe', recipe, step: 0 });
			return [
				`Receta «${recipe.title}» (de ${saved.sourceName}) en marcha en el dispositivo, en el paso 1 de ${recipe.steps.length}.`,
				`Ingredientes: ${recipe.ingredients.join('; ') || 'no dichos'}.`,
				`Paso 1: ${recipe.steps[0]!.text}`
			].join('\n');
		}
		case 'search_recipe_sites': {
			if (typeof args.query !== 'string' || !args.query.trim()) return 'Falta qué buscar.';
			const site = Number.isInteger(args.site) ? Number(args.site) : undefined;
			const found = await searchRecipeSites(args.query, site, 6);
			return found.length
				? found.map((r) => `- ${r.title} (${r.site}): ${r.url}`).join('\n')
				: 'No hay ninguna con esas palabras en las webs favoritas.';
		}
		case 'cook_from_web': {
			const url = typeof args.url === 'string' ? args.url.trim() : '';
			// Only what the search found: not any address the model writes.
			if (!url || !(await isFavouritePage(url)))
				return 'Esa dirección no es de una web favorita: búscala antes con «search_recipe_sites».';
			const { id } = await importRecipe(url, ctx.user.id);
			return runTool('cook_saved_recipe', { id }, ctx);
		}
		case 'recipe_step': {
			if (!ctx.recipe) return 'No hay receta en marcha en este dispositivo.';
			const step = Number(args.step);
			if (!Number.isInteger(step) || step < 1) return 'Falta el número del paso, desde 1.';
			ctx.outcome.actions.push({ kind: 'recipeStep', step: step - 1 });
			return `La receta va por el paso ${step}.`;
		}
		case 'end_recipe':
			if (!ctx.recipe) return 'No hay receta en marcha en este dispositivo.';
			ctx.outcome.actions.push({ kind: 'endRecipe' });
			return 'Receta quitada.';
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

/** The road mode (#78): what is said while driving. */
const CAR =
	'[En el coche, conduciendo (modo carretera): solo audio, aquí. Nunca vídeo: si pide una serie, una película o un canal de televisión, dile que en el coche no se pone vídeo (no que no lo encuentras) y ofrécele música, radio o un podcast. Respuestas muy cortas: las oye quien conduce.]';

/** Routes and where we are: only where there is a map and a GPS, the road mode. */
const ONLY_IN_THE_CAR = new Set(['navigate_to', 'where_am_i', 'stop_navigation', 'take_photo']);

/** Nothing to see, cook or watch while driving: not even offered to the AI. */
const NOT_IN_THE_CAR = new Set([
	'search_video',
	'series_episodes',
	'play_video',
	'send_clip',
	'kitchen_mode',
	'start_recipe',
	'cook_saved_recipe',
	'search_recipe_sites',
	'cook_from_web',
	'recipe_step',
	'end_recipe'
]);

/** Where an order's time went, for the Registro: to know what to make quicker. */
export interface VoiceTiming {
	/** Reading what the instructions list (albums, recipes…). */
	prepareMs: number;
	/** Each turn with the model: its time, its tokens (and how many were cached), its tools. */
	rounds: { ms: number; prompt: number; cached: number; completion: number; tools: string[] }[];
}

/**
 * What was said, done: what the device must do, and the sentence to read aloud. `user`: who speaks,
 * from the session; an adult, a child's account has no voice. `satellite`: said to a voice satellite
 * (#223), by anyone in the room: `user` is who made its key, in whose name what it writes goes, but
 * without their name nor what they watch.
 */
export async function runVoiceCommand(
	request: VoiceRequest,
	user: Person,
	satellite: Satellite | null = null
): Promise<VoiceReply & { timing: VoiceTiming }> {
	/** Where its timers and alarms are kept and sound (#241): a satellite's; a phone's, its own. */
	const place: AlarmPlace | null = satellite ? `satelite:${satellite.id}` : null;
	/** This order, told apart from the next: Telegram's «sí» comes in another (#243). */
	const order = randomUUID();
	const started = performance.now();
	const [albums, playlists, model, { hoursSince }, keepHistory, watchingHere, recipes, sites] =
		await Promise.all([
			getAlbums(),
			listPlaylists(),
			voiceModel(),
			historySince(satellite ? [] : [user]),
			satellite ? true : keepsHistory(user.id),
			videoText(request.video),
			listRecipes(),
			listRecipeSites()
		]);
	const timing: VoiceTiming = { prepareMs: Math.round(performance.now() - started), rounds: [] };
	const reply = (text: string, outcome: Outcome) => ({ ...replyOf(text, outcome), timing });
	// In the car the house's speakers are far away.
	const house = snapcastReady() && !request.car;
	const rooms: Room[] = house
		? ((await listSpeakers()) ?? []).map((s) => ({ id: s.id, name: s.name }))
		: [];
	const outcome: Outcome = { actions: [], options: [], asked: null, done: 0 };
	// A satellite's timers are kept by the server; a phone's, in it (until #241, phase 3).
	const alarmLines = await describeAlarms(place, satellite ? null : user.id);
	const messages: ToolChatMessage[] = [
		{
			role: 'system',
			content: [
				{
					type: 'text',
					text: instructions({
						albums,
						playlists,
						house,
						hoursSince,
						keepHistory,
						recipes,
						sites
					}),
					cache_control: { type: 'ephemeral' }
				}
			]
		},
		...request.history,
		{
			role: 'user',
			content: [
				{ type: 'text', text: `[${todayText()}]` },
				{
					type: 'text',
					text: satellite
						? `[Te habla alguien de la casa desde «${satellite.name}», un satélite de voz sin pantalla: no sabes quién es, así que sin nombres; tampoco hay historial de lo que ve cada uno. El satélite no pone música, radio ni vídeos: aquí es toda la casa, y de un capítulo solo el audio. Los temporizadores y las alarmas que pongas desde aquí suenan donde contesta el satélite, con un «din-don» y su nombre, así que dales un nombre que se entienda al oírlo («pedir cita en la peluquería»); son de la casa, salvo que diga para quién.]`
						: `[Te habla: ${user.name}.]`
				},
				{ type: 'text', text: soundingNow(request.here, house) },
				{
					type: 'text',
					text: satellite
						? `[Temporizadores y alarmas: ${alarmLines.length ? alarmLines.join('; ') : 'ninguno'}.]`
						: `[Temporizadores aquí: ${request.timers.length ? request.timers.join('; ') : 'ninguno'}.] [Alarmas (de la casa y suyas; suenan en toda la casa o en un satélite): ${alarmLines.length ? alarmLines.join('; ') : 'ninguna'}.]`
				},
				...(request.recipe
					? [{ type: 'text' as const, text: `[Receta en marcha aquí:\n${request.recipe}]` }]
					: []),
				...(watchingHere ? [{ type: 'text' as const, text: watchingHere }] : []),
				...(request.car
					? [
							{ type: 'text' as const, text: CAR },
							{
								type: 'text' as const,
								text: `[Ruta: ${request.navigation ?? 'ninguna'}.]`
							}
						]
					: []),
				{ type: 'text', text: request.text }
			]
		}
	];
	const available = [
		...tools(house, rooms),
		...(satellite ? [] : historyTools({ self: user })),
		...(await telegramTools(user.id, Boolean(satellite)))
	].filter((t) =>
		request.car ? !NOT_IN_THE_CAR.has(t.function.name) : !ONLY_IN_THE_CAR.has(t.function.name)
	);

	for (let round = 0; round < MAX_ROUNDS; round++) {
		const asked = performance.now();
		const answer = await chatWithTools({
			model,
			messages,
			tools: available,
			label: `Voz: «${request.text}»`,
			details: { round }
		});
		timing.rounds.push({
			ms: Math.round(performance.now() - asked),
			prompt: answer.usage?.prompt_tokens ?? 0,
			cached: answer.usage?.prompt_tokens_details?.cached_tokens ?? 0,
			completion: answer.usage?.completion_tokens ?? 0,
			tools: answer.toolCalls.map((c) => c.function.name)
		});
		if (!answer.toolCalls.length) {
			return reply(answer.content ?? 'Hecho.', outcome);
		}
		messages.push({ role: 'assistant', content: answer.content, tool_calls: answer.toolCalls });
		// Each call done gives the device something to do; a failed one says why, and gives nothing.
		const said: string[] = [];
		let oneRound = true;
		for (const call of answer.toolCalls) {
			const before = outcome.actions.length + outcome.done;
			let result: ToolResult;
			try {
				const args = JSON.parse(call.function.arguments || '{}');
				if (typeof args.say === 'string' && args.say.trim()) said.push(args.say.trim());
				else oneRound = false;
				result = await runTool(call.function.name, args, {
					albums,
					playlists,
					house,
					outcome,
					user,
					video: request.video,
					recipe: request.recipe,
					position: request.position,
					satellite: Boolean(satellite),
					place,
					satelliteName: satellite?.name ?? null,
					order,
					rooms
				});
			} catch (err) {
				result = `Error: ${err instanceof Error ? err.message : String(err)}`;
			}
			messages.push({ role: 'tool', tool_call_id: call.id, content: result });
			if (!ONE_ROUND.has(call.function.name) || outcome.actions.length + outcome.done === before)
				oneRound = false;
		}
		if (outcome.asked) return reply(outcome.asked, outcome);
		if (oneRound) return reply(said.join(' '), outcome);
	}
	return reply(
		outcome.actions.length ? 'Hecho.' : 'No he sabido hacerlo. Prueba a decirlo de otra forma.',
		outcome
	);
}

const replyOf = (text: string, outcome: Outcome): VoiceReply => ({
	reply: text.trim(),
	actions: outcome.actions,
	options: outcome.options
});

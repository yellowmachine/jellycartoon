import { STATIONS, COUNTRIES } from 'comun/radio.ts';
import { parseRecipe } from 'comun/recipe.ts';
import { distanceText, type LngLat, type Place } from 'comun/road.ts';
import { isPoiKind, POI_KINDS, type FoundPlace } from 'comun/road/pois.ts';
import { AHEAD_UP_TO_METRES } from 'comun/road-guide.ts';
import { MAX_SNOOZE_MIN, SNOOZE_MIN, isAlarmPlace, type AlarmPlace } from 'comun/alarms.ts';
import { EXPENSE_CATEGORIES, euros, isCategory, type ExpenseLine } from 'comun/expenses.ts';
import { isUntilWord, UNTIL_WORDS, untilDay, untilText } from 'comun/fridge.ts';
import { fold } from 'comun/music.ts';
import {
	MAX_STOP_LATER_MIN,
	MAX_TIMER_SEC,
	SAID_NO_CREDIT,
	type VoiceAction,
	type VoiceOption,
	type VoiceReply,
	type VoiceTarget
} from 'comun/voice.ts';
import type {
	HouseHandResult,
	HouseVoiceOrder,
	VoiceRoom,
	VoiceTiming
} from 'comun/house-voice.ts';
import {
	addItems,
	addNote,
	tickOffByName,
	toBuy,
	today,
	type Kitchen
} from '#lib/server/fridge.ts';
import { addExpense, favoriteExpenses } from '#lib/server/expenses/expenses.ts';
import { getRecipe, importRecipe, listRecipes } from '#lib/server/recipes/import.ts';
import {
	isFavouritePage,
	listRecipeSites,
	refreshStale,
	searchRecipeSites
} from '#lib/server/recipes/sites.ts';
import { personOf } from '#lib/server/agenda/agenda.ts';
import {
	addEventByVoice,
	agendaByVoice,
	changeAlarmByVoice,
	setAlarmByVoice
} from '#lib/server/agenda/voice.ts';
import {
	cancelTimers,
	cancelTimersAt,
	describeAlarms,
	describeTimersOf,
	startTimer,
	startTimerAt
} from '#lib/server/alarms/alarms.ts';
import { botHasGroup, sayInGroup } from '#lib/server/telegram/bot.ts';
import { tellHouse } from '#lib/server/house.ts';
import { orsFor } from '#lib/server/road/ors.ts';
import { listSavedPlaces, listSavedRoutes } from '#lib/server/trips/places.ts';
import { asksForRoute, findByName } from 'comun/saved-places.ts';
import { familyPlace, openRouterKey, orsKey } from '#lib/server/family-settings.ts';
import {
	chatWithTools,
	NO_CREDIT,
	type Tool,
	type ToolChatMessage
} from '#lib/server/openrouter.ts';
import { quietCheck } from './quiet-check.ts';
import {
	afterOrder,
	assumedNote,
	countHits,
	learnFrom,
	recallLearned,
	sharesWords
} from './learned.ts';
import { FALLBACK_VOICE_MODEL, personVoiceStyle, voiceSettings } from './settings.ts';
import { voiceFellBack } from './alarm.ts';
import { searchWeb, WEB_TOOL, webSearchTool } from './web-search.ts';
import { forecast, placeName } from 'comun/weather.ts';
import { findPlacesFor } from '#lib/server/places.ts';
import {
	describeMemories,
	forget,
	MAX_MEMORY,
	recallMemories,
	remember
} from '#lib/server/memory.ts';
import { familyPeople } from '#lib/server/agenda/agenda.ts';
import { leaveMessage, MAX_MESSAGE } from '#lib/server/inbox.ts';
import { ruleEvent } from '#lib/server/rule-events.ts';
import { learnFromOrder } from '#lib/server/learn.ts';
import { deleteRule, listRules, saveRule, sameName, translateRule } from '#lib/server/rules.ts';
import { dosesFor, listMedication, markDose } from '#lib/server/medication.ts';
import { MAX_RULE } from '#lib/rules.ts';
import { localDay, localTime } from 'comun/agenda.ts';

/**
 * Voice commands (#33), the family's brain since #253: what was said in the house, to a model with
 * the actions as tools, and said back in a sentence to be read aloud. The family's own (the fridge,
 * the recipes, the expenses, the agenda and the alarms, its Telegram group, the web) are done here;
 * the house's (its music and speakers, its videos, what each one watched, its satellites' timers…),
 * asked of the house (`HOUSE_TOOLS`, its /api/v1/voz), which sent the order with what only it knows
 * (comun/house-voice.ts).
 */

/**
 * Turns with the model before giving up: a search, an action and the answer are three; an episode
 * by its series and season, five.
 */
const MAX_ROUNDS = 7;
/**
 * Tools whose result tells the model nothing new when they do what they were asked (they leave
 * the device something to do). They take the answer too (`say`): with only these, it is read
 * without a second turn with the model (about a second less). Asked in the instructions instead,
 * the model wrote it only sometimes.
 */
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
	'end_recipe',
	'remember',
	'forget_memory'
]);
/** An order that already kept or forgot something itself: nothing more to learn from it (#331). */
const ASKED_TO_KEEP = new Set([
	'remember',
	'forget_memory',
	'create_rule',
	'delete_rule',
	'leave_message'
]);
const SAY = {
	type: 'string',
	description:
		'La frase de respuesta, que se lee en voz alta si sale bien, p. ej. «Pongo un temporizador de un minuto».'
};

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
	/** What was learned there that it went by (`used_learned`), not asking (learned.ts). */
	usedLearned: number[];
}

/** A speaker of the house (Snapcast), by its name: only there (#223). */
type Room = VoiceRoom;

/** Their names, but those of the other places: «here», «house», and for videos «salon» (the TV). */
const roomNames = (rooms: Room[], taken: string[]) =>
	[...new Set(rooms.map((r) => r.name))].filter((n) => !taken.includes(fold(n)));

const targets = (house: boolean, rooms: Room[]): string[] =>
	house
		? ['here', 'house', ...roomNames(rooms, ['here', 'house'])]
		: (['here'] satisfies VoiceTarget[]);

const ROOMS =
	' O el nombre de un altavoz de la casa: solo ahí, y los demás callan (p. ej. «en el dormitorio»).';

function tools(house: boolean, rooms: Room[], salon: boolean, clipMinutes: number): Tool[] {
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
			'add_stop',
			'Modo carretera: una parada en el camino a donde va, que sigue siendo su destino; el mapa recalcula la ruta pasando por ella. «Para en…», «añade una parada en…», «de camino, pasa por…». «Vamos a…» o «llévame a…» no es una parada: es navigate_to, un destino nuevo.',
			{
				place: {
					type: 'string',
					description:
						'Dónde parar, como se diría a un navegador: «Totana», «Lorca, Murcia». Uno de sus sitios guardados, tal cual lo dice: «casa de los abuelos».'
				},
				reason: {
					type: 'string',
					description:
						'Para qué, si lo dice, corto y como iría tras «para»: «comprar pan casero», «comer». Vacío si no lo dice.'
				}
			},
			['place']
		),
		fn(
			'find_places',
			'Modo carretera: busca sitios de un tipo en un pueblo, una ciudad o donde está: «busca una panadería en Totana», «¿hay una farmacia por aquí?», «una gasolinera en Lorca». Para elegir uno y parar o ir allí.',
			{
				what: {
					type: 'string',
					enum: Object.keys(POI_KINDS),
					description: 'Qué tipo de sitio; el más parecido a lo que dice.'
				},
				place: {
					type: 'string',
					description: 'Dónde: «Totana», «Lorca, Murcia». Vacío: cerca de donde está.'
				}
			},
			['what']
		),
		fn(
			'find_on_route',
			'Modo carretera: busca sitios de un tipo junto a la ruta que lleva, por delante, el primero al que llega primero: «para en la próxima gasolinera», «un sitio para comer de camino», «¿hay un cajero en la ruta?». Para parar en uno.',
			{
				what: {
					type: 'string',
					enum: Object.keys(POI_KINDS),
					description: 'Qué tipo de sitio; el más parecido a lo que dice.'
				},
				within_km: {
					type: 'number',
					description: `En cuántos km por delante, si lo dice («en los próximos 20 km»), hasta ${AHEAD_UP_TO_METRES / 1000}. Sin él, ${ON_ROUTE_KM}.`
				}
			},
			['what']
		),
		fn(
			'remove_stop',
			'Modo carretera: quita una parada de la ruta (o todas), sin cambiar el destino. «Quita la parada de…», «ya no paramos en…», «sin paradas».',
			{
				stop: {
					type: 'string',
					description: 'La parada, por su nombre, como sale en la ruta. Vacío: todas.'
				}
			},
			[]
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
					description: `Cuántos minutos hacia atrás, hasta ${clipMinutes}; 0.5 son 30 segundos.`
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
			`Pone un capítulo o una película. El id sale de «search_video», «series_episodes» o las herramientas de lo visto («[episodio 12]», «[película 3]»). ${salon ? 'Los capítulos, aquí (en el navegador del dispositivo) o en el salón (la tele); las películas, solo en el salón.' : 'Solo capítulos, aquí (en el navegador del dispositivo): no hay salón.'}`,
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
						...(salon ? ['salon'] : []),
						...(house ? ['house', ...roomNames(rooms, ['here', 'house', 'salon'])] : [])
					],
					description: `«here»: el dispositivo desde el que se habla. ${salon ? '«salon»: la tele del salón. ' : ''}${house ? `Solo el audio de un capítulo, sin imagen (para oírlo o dormirse con él): «house», toda la casa (Snapcast).${rooms.length ? ROOMS : ''}` : ''}`
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
			'Apunta un gasto en los gastos de la casa (#194), que ven todos los adultos. «He gastado 40 euros en gasolina», «apunta 12,50 de la farmacia», «la cena ha sido 63 euros». Uno de sus favoritos, por su nombre: «apunta el café de siempre», «lo del súper de siempre, hoy 54 euros».',
			{
				favorite: {
					type: 'string',
					description:
						'Si es uno de los favoritos («de siempre», «como siempre»): su nombre, como lo dice («café»). Con él, «what» y «category» sobran, y «amount» solo si dice otro importe.'
				},
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
			[]
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
			'Cambia una alarma de la lista por su número: quitarla («delete»); que no suene unos días sin quitarla («skip»: sin «from», solo la próxima vez, «hoy ya me he levantado», «mañana no»; con «from» y «to», esos días, «el jueves no», «del 1 al 15 de agosto no»); que vuelva a sonar un día que se saltaba («unskip», «al final mañana sí»); cambiarle la hora, los días o el nombre sin quitarla («edit», «cámbiala a las 6:30», «quítale el sábado»); pausarla, activarla, o pararla si está sonando; o posponer la que suena o acaba de sonar («snooze», «pospón», «cinco minutos más»): vuelve a sonar dentro de esos minutos, y los demás días sigue igual.',
			{
				id: { type: 'integer', description: 'El número de la alarma, de la lista.' },
				do: {
					type: 'string',
					enum: ['delete', 'skip', 'unskip', 'edit', 'pause', 'resume', 'stop', 'snooze']
				},
				from: {
					type: 'string',
					description:
						'Con «skip» o «unskip»: el primer día, AAAA-MM-DD. Obligatorio con «unskip»; sin él, «skip» se salta solo la próxima.'
				},
				to: {
					type: 'string',
					description: 'Con «skip» o «unskip»: el último día, AAAA-MM-DD. Vacío: solo «from».'
				},
				time: { type: 'string', description: 'Con «edit»: la hora nueva, HH:MM en 24 horas.' },
				days: {
					type: 'array',
					items: { type: 'integer' },
					description:
						'Con «edit»: todos los días que se repite ahora, 0 el lunes y 6 el domingo (quitarle el sábado a una de todos los días: [0,1,2,3,4,6]). Vacío: una vez.'
				},
				day: {
					type: 'string',
					description: 'Con «edit», si es de una vez: el día nuevo, AAAA-MM-DD.'
				},
				label: { type: 'string', description: 'Con «edit»: el nombre nuevo.' },
				minutes: {
					type: 'number',
					description: `Con «snooze»: dentro de cuántos minutos vuelve a sonar, hasta ${MAX_SNOOZE_MIN}. Sin él, ${SNOOZE_MIN}.`
				}
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
 * How each order ends (`tool_choice: required`): the sentence to read aloud, and whether it waits
 * for an answer, said by the model rather than guessed from a «?» (a question first and then more
 * words, or none at all).
 */
const answerTool: Tool = {
	type: 'function',
	function: {
		name: 'answer',
		description:
			'La respuesta final a la orden, que se lee en voz alta. Siempre la última, y sola: cuando ya sabes lo que han hecho las demás.',
		parameters: {
			type: 'object',
			properties: {
				text: {
					type: 'string',
					description: 'Una sola frase corta, en español, sin listas, emojis, ids ni formato.'
				},
				expects_answer: {
					type: 'boolean',
					description:
						'Sí si esperas su respuesta para seguir: le preguntas algo (te falta un dato: «¿Media hora de qué?») o le ofreces hacer algo («¿Quieres que lo ponga?», «Si quieres uno, dime para qué y lo pongo»); así se le escucha sin que diga otra vez la palabra. No si solo cuentas o confirmas, sin nada que contestar.'
				}
			},
			required: ['text', 'expects_answer'],
			additionalProperties: false
		}
	}
};

/**
 * Said with the calls it goes with, when what it does is by something learned there: so a
 * correction after it rewrites it (learned.ts). Only with some learned in the order.
 */
const usedLearnedTool: Tool = {
	type: 'function',
	function: {
		name: 'used_learned',
		description:
			'Junto con lo que haces, en la misma vez: los números de lo aprendido aquí por lo que lo haces sin preguntar.',
		parameters: {
			type: 'object',
			properties: { ids: { type: 'array', items: { type: 'integer' } } },
			required: ['ids'],
			additionalProperties: false
		}
	}
};

/**
 * What the family asks it to remember (memory.ts): kept, forgotten, said. Not for children, and
 * on a satellite (no one known) only the house's.
 */
function memoryTools(satellite: boolean): Tool[] {
	const tool = (name: string, description: string, properties: object, required: string[]) =>
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
		tool(
			'remember',
			'Guarda algo que te piden recordar para contestarlo cuando lo pregunten («recuerda que la llave de repuesto está en la maceta», «apúntate que la talla de pie de Lucía es la 32»), también solo por unos días («hasta el viernes, el coche está en el taller»). No los avisos a una hora (la agenda), ni la compra o las notas de la nevera. Si cambia algo ya guardado («ahora la llave está en el cajón»), olvida antes lo viejo con «forget_memory».',
			{
				text: {
					type: 'string',
					description: `Lo que hay que recordar, en una frase que se entienda sola, sin «yo» ni «mi» ni las fechas: «La llave de repuesto está en la maceta de la entrada». Hasta ${MAX_MEMORY} letras.`
				},
				from_day: {
					type: 'string',
					description:
						'Solo si vale a partir de un día («desde el lunes…»): ese día, AAAA-MM-DD, contando desde hoy.'
				},
				until_day: {
					type: 'string',
					description:
						'Solo si vale hasta un día («hasta el viernes», «esta semana», «mientras estoy de viaje del 5 al 12»): el último día, AAAA-MM-DD, contando desde hoy; luego se olvida solo.'
				},
				...(satellite
					? {}
					: {
							whose: {
								type: 'string',
								enum: ['me', 'house'],
								description:
									'«me»: solo de quien habla (nadie más lo ve), por defecto si es suyo («mi talla», «mi contraseña del wifi del trabajo»). «house»: de toda la casa, si es de todos o lo dice para todos («la llave de la casa»).'
							}
						})
			},
			satellite ? ['text'] : ['text', 'whose']
		),
		tool(
			'forget_memory',
			'Olvida algo guardado, por su número (de lo que te han pedido recordar, o de «list_memories»). También lo deducido por una regla cuando ya no vale («ya he recogido la ropa» olvida «Hay ropa tendida»).',
			{ id: { type: 'integer' } },
			['id']
		),
		tool(
			'list_memories',
			'Todo lo que te han pedido recordar y puede ver quien habla, para «¿qué te he pedido que recuerdes?», o para buscar algo que no está en el mensaje.',
			{},
			[]
		)
	];
}

/** A message for someone of the family, in their «Buzón» and on their phone (inbox.ts, #331). */
const messageTool: Tool = {
	type: 'function',
	function: {
		name: 'leave_message',
		description:
			'Deja un recado en el buzón de alguien de la familia, con aviso en su móvil («déjale un recado a Ana: que compre pan», «dile a papá que ya he llegado»). No para el grupo de Telegram ni para recordar algo uno mismo.',
		parameters: {
			type: 'object',
			properties: {
				to: {
					type: 'array',
					items: { type: 'string' },
					description:
						'Sus nombres, como en la familia del mensaje («Ana»), o «todos» para toda la familia menos quien habla.'
				},
				text: {
					type: 'string',
					description: `El recado, para leerlo quien lo recibe: «Que compres pan al volver». Hasta ${MAX_MESSAGE} letras.`
				}
			},
			required: ['to', 'text'],
			additionalProperties: false
		}
	}
};

/**
 * The family's rules (rules.ts, #331): made from what is said (the AI understands it once, and the
 * server checks it), said back, and taken out. Not for children; on a satellite, the house's.
 */
function ruleTools(satellite: boolean): Tool[] {
	const tool = (name: string, description: string, properties: object, required: string[]) =>
		({
			type: 'function',
			function: {
				name,
				description,
				parameters: { type: 'object', properties, required, additionalProperties: false }
			}
		}) satisfies Tool;
	return [
		tool(
			'create_rule',
			'Crea una regla que se comprueba sola y avisa: «cuando vengan mis padres, recuérdame que les diga lo de las plantas», «si pongo leche en la lista y estoy de viaje, avísame», «todos los días a las diez, si no hay nada en la agenda, dime que descanse». No para un aviso a una hora fija (la agenda), ni para recordar algo (remember). Contesta con cómo la has entendido.',
			{
				text: {
					type: 'string',
					description: `La regla tal como la ha dicho, completa. Hasta ${MAX_RULE} letras.`
				},
				...(satellite
					? {}
					: {
							whose: {
								type: 'string',
								enum: ['me', 'house'],
								description:
									'«me»: solo de quien habla, por defecto. «house»: de toda la casa, si es para todos.'
							}
						})
			},
			satellite ? ['text'] : ['text', 'whose']
		),
		tool(
			'list_rules',
			'Las reglas que puede ver quien habla, con su número: «¿qué reglas tengo?», o para borrar una.',
			{},
			[]
		),
		tool(
			'delete_rule',
			'Borra una regla por su número (de «list_rules»).',
			{ id: { type: 'integer' } },
			['id']
		)
	];
}

/** «Ya me he tomado la pastilla»: their own doses due now, marked (Medicación, #308). */
const markDoseTool: Tool = {
	type: 'function',
	function: {
		name: 'mark_dose',
		description:
			'Marca como tomada la medicación de quien habla que toca ahora o hace poco («ya me he tomado la pastilla», «me he tomado el Sintrom»). Solo la suya.',
		parameters: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'El nombre del medicamento, si lo dice; si no, vacío: las que tocan ahora.'
				}
			},
			required: ['name'],
			additionalProperties: false
		}
	}
};

/** A dose counts as «now» from this long before its time. */
const DOSE_EARLY_MIN = 60;

/** The family's Telegram group (#243), with its bot: only when it is in one. */
const groupSayTool: Tool = {
	type: 'function',
	function: {
		name: 'group_say',
		description:
			'Dice algo en el grupo de Telegram de la familia, con el bot de la casa («di en el grupo que ya está la comida», «avisa a la familia de que llego tarde»). Sale como el bot, diciendo de quién o de dónde viene.',
		parameters: {
			type: 'object',
			properties: {
				text: { type: 'string', description: 'Lo que hay que decir, corto: «Ya está la comida».' }
			},
			required: ['text'],
			additionalProperties: false
		}
	}
};

/**
 * What the model knows before calling anything: how to answer, the library and the stations. The
 * same from one command to the next, so that it is cached; what sounds now goes with each command.
 */
function instructions(context: {
	/** The music library, as the house says it (comun/house-voice.ts). */
	library: string[];
	playlists: { id: number; name: string; total: number }[];
	house: boolean;
	/** A living room to put videos on. */
	salon: boolean;
	/** How to read what each one watched, as the house says it. */
	historyRules: string;
	/** «Guardar lo que veo», in Ajustes. */
	keepHistory: boolean;
	/** The family's recipe book. */
	recipes: { id: number; title: string; sourceName: string }[];
	/** The family's favourite cooking sites. */
	sites: { id: number; name: string; host: string }[];
	/** «Cómo es la voz de la casa» (Ajustes → La voz), free text; null, none. */
	style: string | null;
}) {
	const { library, playlists, house, salon, historyRules, keepHistory, recipes, sites, style } =
		context;

	return `Eres el asistente de voz de JellyCartoon, la app de música y vídeo de una casa. Te hablan desde el móvil, a veces una persona mayor, a veces alguien con las manos ocupadas (cocinando, por ejemplo); lo que dice viene de un reconocimiento de voz y puede traer nombres mal escritos: busca por cómo suenan. Con una tele o una radio de fondo pueden colarse frases sueltas de ella, en medio o al final: haz caso solo a lo que tiene sentido como orden o pregunta para ti e ignora lo demás.

Cómo responder:
- Trátala de tú. Con cada orden va quién habla: llámala por su nombre de pila de vez en cuando (al saludar, al despedirse, con una buena noticia), no en cada respuesta.
- Haz lo que pide con las herramientas, sin pedir confirmación. Si se equivoca, lo dirá («no, eso no», «para»).
- Al terminar una orden, contesta con «answer»: en español, una sola frase corta que diga lo que has hecho y dónde, p. ej. «Pongo Alaska y Dinarama aquí». Se lee en voz alta: sin listas, emojis, ids ni formato.
- Si no está claro qué pide y no son pocas opciones que nombrar («media hora», sin más), pregúntalo con «answer» y «expects_answer»: su respuesta llega como la orden siguiente.
- Si lo encuentras con otro nombre porque se oyó mal («Boyman Rhapsody» es «Bohemian Rhapsody»), no lo expliques: di solo lo que pones, con su nombre bien («Pongo Bohemian Rhapsody de Queen en toda la casa»). Cada palabra de más se tarda en decir.
- Lo que te han pedido recordar viene en el mensaje, con su número; para «¿dónde está…?», «¿cuál era…?», contesta con eso, y si no está, mira «list_memories» antes de decir que no lo sabes. Nunca lo inventes.
- Si duda entre pocas opciones, usa «ask», con una pregunta que las nombre («¿El álbum Deseo carnal o la canción?»): quien la oye quizá no ve los botones, y contesta de palabra. Si la orden siguiente es esa respuesta («la segunda», «el álbum», «el de Alaska»), haz la orden de la opción que elige: van en el turno de tu pregunta. Si no encuentras algo, dilo y propón lo más parecido que haya.
- Contesta solo a la orden de ahora. Las anteriores sirven para entenderla («la segunda», «quita eso»), no para volver a sacarlas: si esta va de otra cosa («¿qué hora es?» después de hablar de alarmas), no añadas preguntas ni ofrecimientos de lo de antes.
- Si no dice dónde, es aquí${house ? ', salvo que lo que quiere controlar solo esté sonando en toda la casa' : ''}.
- «Quita eso», «para», «más alto»…: se refiere a lo que está sonando. Con cada orden va lo que suena en cada sitio.
- Sitios: aquí (el dispositivo desde el que se habla)${house ? ' y toda la casa (Snapcast), o uno solo de sus altavoces por su nombre' : '; toda la casa no está disponible'}.${
		style
			? `\n- Tu carácter, como lo ha pedido la casa (solo el tono: lo de arriba manda, las respuestas siguen siendo cortas y nunca te saltas una pregunta de confirmación): «${style}».`
			: ''
	}

Otras preguntas (de cocina, de lo que sea): si no pide nada de la app, contesta tú, como un asistente general, sin herramientas.
- Es para oírlo mientras hace otra cosa: dos o tres frases cortas como mucho, con lo esencial primero. Números y cantidades claros («doscientos gramos», «diez minutos»).
- Nada de listas, tablas ni formato. Si la respuesta es larga (una receta entera, unos pasos), da el primero o lo esencial y ofrece seguir: «¿Te digo el siguiente paso?».
- Si pregunta por algo de lo que suena (el podcast, la canción), contesta con lo que sepas sin cambiar lo que suena.
- Una pregunta no es una orden: «¿cuánto tiempo cuezo la pasta?» se contesta; «pon Más de uno» se hace.
- Si es de salud o de seguridad (alergias, algo que ha comido mal, un corte), contesta con prudencia y, si puede ser serio, dile que llame al médico o al 112.

El tiempo («¿qué tiempo hará mañana?», «¿llueve esta tarde?», «¿hace frío para salir?»): «get_weather», sin preguntar. Contesta corto, solo lo que pregunta: el cielo, las temperaturas y, si puede llover, la probabilidad. Nunca lo inventes.

Temporizadores («avísame en 10 minutos», «pon un temporizador de 20 minutos para el horno»): «set_timer», sin preguntar. Con cada orden va la lista de los que hay en este dispositivo.
Actualidad que no sabes (resultados, noticias, horarios, precios): «web_search» si la tienes, con la pregunta completa, y contesta corto con lo que encuentre; si no la tienes, di que no puedes buscar en internet (se activa en Ajustes → La voz, en Seilide).
Telegram: «dile a Ana que…», «contesta a…», «manda al grupo de… que…» son mensajes de su propia cuenta: «telegram_send» y luego «ask» («¿Le mando a Ana: "llego en diez minutos"?»), y con su respuesta «telegram_confirm»; nunca lo envíes sin su sí. «Di en el grupo que…», «avisa a la familia de que…» son del bot de la casa: «group_say». Si no tienes la herramienta, dile que no está conectado.
Alarmas a una hora («despiértame a las 7», «todos los días laborables a las 7:30», «el jueves a las 9 la cita del médico»): «set_alarm». Con cada orden va la lista de alarmas, con su número: para quitarla, saltarse unos días sin quitarla («hoy ya me he levantado», «mañana no me despiertes», «en vacaciones no»), deshacer un salto, cambiarle la hora o los días, pausarla o pararla, «change_alarm» con ese número (nunca la quites para ponerla de nuevo); si no está claro cuál, usa «ask».
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
- Si quiere volver a verlo, búscalo con esas herramientas y ponlo con «play_video». Si no dice dónde, aquí${salon ? '; una película, en el salón' : ''}.

Langua: «manda los últimos 5 minutos a Langua», «manda a Langua», «guárdame esto para estudiar», o solo «Langua» → «send_clip», sin preguntar. Sin tiempo, 30 segundos (minutes 0.5). El reconocimiento de voz puede escribir «lengua» o «la lengua»: es Langua. Dile qué se ha mandado, corto.

Series y películas: «search_video» para encontrarlas, «series_episodes» para elegir capítulo, «play_video» para ponerlas.
- «Pon Friends»: el capítulo que tenga a medias, o el siguiente al último visto; si no ha visto ninguno, el primero.
- «Temporada 3, capítulo 7»: búscalo en esa temporada con «series_episodes».
- Si hay varias que encajan (dos películas con el mismo título, una serie y una película…), usa «ask».
${historyRules}
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

/** What starts something sounding: in the «horas de silencio», only after a «sí». */
const SOUNDING = new Set(['play_music', 'play_radio', 'play_video']);

/**
 * The house's own, done there (its /api/v1/voz): its music and speakers, its videos, its satellites'
 * and devices' timers, the weather where it is, Langua;
 * and the tools it sent with the order (what each one watched, their Telegram).
 */
const HOUSE_TOOLS = new Set([
	'search_music',
	'play_music',
	'play_radio',
	'control',
	'stop_later',
	'set_volume',
	'get_weather',
	'send_clip',
	'search_video',
	'series_episodes',
	'play_video',
	'set_timer',
	'prepare_timer',
	'cancel_timer'
]);

/**
 * Without the house (a family with none, or it does not answer): what only it does, not offered.
 * The timers are the cloud's (`cloudTimer`), and the weather is asked from here (`cloudWeather`).
 */
const ONLY_THE_HOUSE = [...HOUSE_TOOLS].filter(
	(name) => !['set_timer', 'cancel_timer', 'get_weather'].includes(name)
);

/** One order's: the family's kitchen in the name of who speaks, and what the house sent. */
interface Turn {
	k: Kitchen;
	order: HouseVoiceOrder;
	outcome: Outcome;
	/** The recipe being cooked here, described; null if none. */
	recipe: string | null;
	satellite: boolean;
	/** Where its alarms are said (a satellite's); null, a phone's. */
	place: AlarmPlace | null;
	/** Said to the cloud: its timers are kept here, this person's (their id); null, the house's. */
	timersOf: string | null;
	/** Said to one of Seilide's satellites (#296): its timers are kept here, at its place. */
	timersAt: AlarmPlace | null;
	apiKey: string;
	settings: Awaited<ReturnType<typeof voiceSettings>>;
	houseTools: Set<string>;
	/** No house to ask (`runVoiceCommand`'s `withHouse`). */
	withoutHouse: boolean;
	/** Whose memory it sees and keeps (memory.ts); null, the house's only (a satellite). */
	memoryOf: string | null;
}

async function runTool(
	name: string,
	args: Record<string, unknown>,
	ctx: Turn
): Promise<ToolResult> {
	if (SOUNDING.has(name) || (name === 'control' && args.action === 'resume')) {
		const quiet = ctx.order.request.car ? null : ctx.settings.quiet;
		const who = ctx.place ?? `user:${ctx.k.userId}`;
		const wait = quietCheck(quiet, `${ctx.k.familyId}:${who}`, ctx.order.order, minuteNow());
		if (wait) return wait;
	}
	if (ctx.timersOf && (name === 'set_timer' || name === 'cancel_timer'))
		return cloudTimer(name, args, ctx, ctx.timersOf);
	if (ctx.timersAt && (name === 'set_timer' || name === 'cancel_timer'))
		return satelliteTimer(name, args, ctx, ctx.timersAt);
	// A place said, with the family's openrouteservice key: looked up here, also with a house, whose
	// search (Open-Meteo's) takes only its name, not «Vélez-Rubio, Almería».
	if (
		name === 'get_weather' &&
		(ctx.withoutHouse ||
			(typeof args.place === 'string' && args.place.trim() && (await orsKey(ctx.k))))
	)
		return cloudWeather(ctx.k, args, ctx.order.request.position);
	if (HOUSE_TOOLS.has(name) || ctx.houseTools.has(name)) {
		const done = await tellHouse<HouseHandResult>(ctx.k.familyId, '/voz', {
			order: ctx.order.order,
			name,
			args
		});
		ctx.outcome.actions.push(...done.actions);
		ctx.outcome.done += done.done;
		return done.result;
	}
	const kid = ctx.order.who.kid;
	switch (name) {
		case WEB_TOOL: {
			const query = typeof args.query === 'string' ? args.query.trim() : '';
			if (!query) return 'Falta qué buscar.';
			try {
				return `Encontrado en internet: ${await searchWeb(ctx.apiKey, ctx.settings, query)}`;
			} catch (err) {
				return `No se pudo buscar: ${err instanceof Error ? err.message : String(err)}`;
			}
		}
		case 'remember': {
			const text = typeof args.text === 'string' ? args.text : '';
			const whose = ctx.memoryOf && args.whose === 'me' ? ctx.memoryOf : null;
			const day = (v: unknown) => (typeof v === 'string' ? v : null);
			const id = await remember(ctx.k, whose, text, {
				fromDay: day(args.from_day),
				untilDay: day(args.until_day)
			});
			if (!id) return 'Falta qué recordar.';
			ctx.outcome.done++;
			return `Guardado con el número ${id}, ${whose ? 'solo para quien habla' : 'para toda la casa'}.`;
		}
		case 'leave_message': {
			const text = typeof args.text === 'string' ? args.text : '';
			const names = Array.isArray(args.to) ? args.to.filter((n) => typeof n === 'string') : [];
			const people = (await familyPeople(ctx.k)).filter((p) => p.userId);
			const speaker = ctx.order.satellite ? null : ctx.k.userId;
			const all = names.some((n) => fold(n.trim()) === 'todos');
			const to = all
				? people.filter((p) => p.userId !== speaker)
				: people.filter((p) => names.some((n) => sameName(p.name, n)));
			const missing = all ? [] : names.filter((n) => !people.some((p) => sameName(p.name, n)));
			if (missing.length)
				return `No hay nadie con cuenta llamado ${missing.join(', ')}: los que pueden recibir recados son ${people.map((p) => p.name).join(', ') || 'nadie'}. Pregúntale a quién era.`;
			const from = ctx.order.satellite
				? { userId: null, name: ctx.order.satellite.name, place: true }
				: { userId: ctx.k.userId, name: ctx.order.who.name || 'alguien de casa' };
			const left = await leaveMessage(
				ctx.k,
				from,
				to.map((p) => p.userId!),
				text
			);
			if (!left) return 'Falta el recado o a quién.';
			ctx.outcome.done++;
			return `Recado dejado en el buzón de ${to.map((p) => p.name).join(', ')}, con aviso en su móvil: «${left}».`;
		}
		case 'create_rule': {
			const said = typeof args.text === 'string' ? args.text : '';
			const whose = ctx.memoryOf && args.whose !== 'house' ? ctx.memoryOf : null;
			const made = await translateRule(
				ctx.k,
				said,
				ctx.order.satellite ? null : ctx.order.who.name || null
			);
			if ('problem' in made) return `No se ha creado: ${made.problem} Díselo.`;
			const id = await saveRule(ctx.k, whose, said, made.understood, made.spec);
			if (!id)
				return 'No se ha creado: la familia ya tiene demasiadas reglas (se borran en Ajustes).';
			ctx.outcome.done++;
			return `Regla ${id} creada, ${whose ? 'solo de quien habla' : 'de toda la casa'}. Así la ha entendido: «${made.understood}». Díselo corto, para que pueda corregirla.`;
		}
		case 'list_rules': {
			const rules = await listRules(ctx.k, ctx.memoryOf);
			return rules.length
				? `Sus reglas: ${rules.map((r) => `${r.id}${r.paused ? ' (en pausa)' : ''}: ${r.understood}`).join(' · ')}`
				: 'No hay ninguna regla todavía.';
		}
		case 'delete_rule': {
			const id = Number(args.id);
			const gone = Number.isInteger(id) ? await deleteRule(ctx.k, ctx.memoryOf, id) : null;
			if (!gone) return `No hay ninguna regla con el número ${args.id} que pueda ver quien habla.`;
			ctx.outcome.done++;
			return `Borrada: «${gone}».`;
		}
		case 'mark_dose': {
			const me = ctx.k.userId ? await personOf(ctx.k, ctx.k.userId) : null;
			if (!me) return 'No sé quién habla: la medicación se marca desde su móvil.';
			const name = typeof args.name === 'string' ? args.name.trim() : '';
			const today = localDay();
			const soon = localTime(new Date(Date.now() + DOSE_EARLY_MIN * 60_000));
			const meds = await listMedication(ctx.k, Number(me));
			const due = (await dosesFor(ctx.k, meds, today)).filter(
				(d) => !d.takenAt && d.time <= soon && (!name || sameName(d.name, name))
			);
			if (!due.length)
				return name
					? `No tiene «${name}» por tomar ahora (ni pendiente de antes hoy).`
					: 'No tiene ninguna toma pendiente ahora.';
			for (const d of due) await markDose(ctx.k, d.medicationId, today, d.time, true);
			ctx.outcome.done++;
			return `Marcado como tomado: ${due.map((d) => `${d.name} de las ${d.time}`).join(', ')}.`;
		}
		case 'forget_memory': {
			const id = Number(args.id);
			const gone = Number.isInteger(id) ? await forget(ctx.k, ctx.memoryOf, id) : null;
			if (!gone) return `No hay nada guardado con el número ${args.id} que pueda ver quien habla.`;
			ctx.outcome.done++;
			return `Olvidado: «${gone}».`;
		}
		case 'list_memories':
			return describeMemories(ctx.k, ctx.memoryOf);
		case 'group_say': {
			const text = typeof args.text === 'string' ? args.text.trim().slice(0, 1000) : '';
			if (!text) return 'Falta qué decir.';
			const from = ctx.order.satellite
				? `Desde ${ctx.order.satellite.name}`
				: ctx.order.who.name || 'Alguien de casa';
			try {
				return `Dicho en el grupo «${await sayInGroup(ctx.k.familyId, from, text)}»: «${text}».`;
			} catch (err) {
				return err instanceof Error ? err.message : String(err);
			}
		}
		case 'navigate_to': {
			const wanted = typeof args.destination === 'string' ? args.destination.trim() : '';
			if (!wanted) return 'Falta el destino.';
			// Their own first (#151): a route if one is asked for, then a place, then a route.
			const [places, routes] = await Promise.all([listSavedPlaces(ctx.k), listSavedRoutes(ctx.k)]);
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
			const place =
				foundPlace(ctx.k, wanted) ?? (await searchPlace(ctx.k, wanted, ctx.order.request.position));
			if (!place)
				return `No encuentro «${wanted}». Pídele que lo diga de otra forma (con el pueblo o la ciudad).`;
			ctx.outcome.actions.push({ kind: 'navigate', place });
			return `Ruta a ${place.label}: el mapa la traza y la va diciendo. Díselo corto.`;
		}
		case 'add_stop': {
			const wanted = typeof args.place === 'string' ? args.place.trim() : '';
			if (!wanted) return 'Falta dónde parar.';
			const reason =
				typeof args.reason === 'string' && args.reason.trim()
					? args.reason.trim().slice(0, 80)
					: null;
			const saved = findByName(await listSavedPlaces(ctx.k), wanted);
			const place = saved
				? { label: saved.name, at: saved.at }
				: (foundPlace(ctx.k, wanted) ??
					(await searchPlace(ctx.k, wanted, ctx.order.request.position)));
			if (!place)
				return `No encuentro «${wanted}». Pídele que lo diga de otra forma (con el pueblo o la ciudad).`;
			// No route on: where to stop is where to go.
			if (!ctx.order.request.navigation) {
				ctx.outcome.actions.push({ kind: 'navigate', place });
				return `No llevaba ruta: ruta a ${place.label}, como destino. Díselo corto.`;
			}
			ctx.outcome.actions.push({ kind: 'addStop', place, reason });
			return `Parada en ${place.label}${reason ? `, para ${reason}` : ''}, antes de su destino, que sigue siendo el mismo: el mapa recalcula la ruta. Díselo corto.`;
		}
		case 'find_places': {
			if (!isPoiKind(args.what)) return 'Ese tipo de sitio no se puede buscar.';
			const what = args.what;
			const town = typeof args.place === 'string' ? args.place.trim() : '';
			const position = ctx.order.request.position;
			const around = town ? (await searchPlace(ctx.k, town, position))?.at : position;
			if (!around)
				return town
					? `No encuentro «${town}». Pídele que lo diga de otra forma.`
					: 'Todavía no se sabe dónde está: el GPS no ha dado la posición.';
			const found = await orsFor(ctx.k).placesAround(around, what);
			keepFound(ctx.k, found);
			const from = town ? `de ${town}` : 'de aquí';
			if (!found.length)
				return `OpenStreetMap no tiene ningún sitio de «${what}» a menos de 2 km ${from} (puede que falte). Díselo${town ? ` y ofrécele parar en ${town} igualmente` : ''}.`;
			const lines = found.map(
				(p, i) =>
					`${i + 1}. ${p.name}, a ${distanceText(p.distance)} ${from}${p.hours ? `; horario de OpenStreetMap «${p.hours}»` : ''}`
			);
			return `Encontradas en OpenStreetMap (puede faltar alguna), la más cerca primero:\n${lines.join('\n')}\nDile las 2 o 3 primeras, muy corto: nombre y distancia (el horario, solo si importa y en palabras). Y pregúntale con ask dónde, una opción por sitio: label «Horno San José, 300 m»; command «${ctx.order.request.navigation ? 'Para en Horno San José' : 'Llévame a Horno San José'}», y detrás su para qué si lo dijo («… para comprar pan»).`;
		}
		case 'find_on_route': {
			if (!isPoiKind(args.what)) return 'Ese tipo de sitio no se puede buscar.';
			const what = args.what;
			const ahead = ctx.order.request.ahead;
			// No route on: around where we are.
			if (!ahead) return runTool('find_places', { what }, ctx);
			const km = Number(args.within_km);
			const upTo =
				Number.isFinite(km) && km > 0
					? Math.min(km * 1000, AHEAD_UP_TO_METRES)
					: ON_ROUTE_KM * 1000;
			const found = await orsFor(ctx.k).placesAlong(ahead, what, upTo);
			keepFound(ctx.k, found);
			if (!found.length)
				return `OpenStreetMap no tiene ningún sitio de «${what}» junto a la ruta en los próximos ${Math.round(upTo / 1000)} km (puede que falte). Díselo corto.`;
			const lines = found.map(
				(p, i) =>
					`${i + 1}. ${p.name}, a ${distanceText(p.distance)} por la ruta, ${(p.off ?? 0) < 150 ? 'junto a la carretera' : `a ${distanceText(p.off ?? 0)} de la carretera`}${p.hours ? `; horario de OpenStreetMap «${p.hours}»` : ''}`
			);
			return `Junto a la ruta, en OpenStreetMap (puede faltar alguno), el primero al que llega primero:\n${lines.join('\n')}\nSi pidió «la próxima», dile solo la primera y pregúntale con ask si para; si no, las 2 o 3 primeras, muy corto: nombre y a cuántos km. Una opción por sitio: label «Repsol, 12 km»; command «Para en Repsol», y detrás su para qué si lo dijo.`;
		}
		case 'remove_stop': {
			const stop = typeof args.stop === 'string' && args.stop.trim() ? args.stop.trim() : null;
			ctx.outcome.actions.push({ kind: 'removeStop', name: stop });
			return `${stop ? `Parada de ${stop} quitada` : 'Paradas quitadas'}; el destino sigue siendo el mismo: el mapa recalcula la ruta. Díselo corto.`;
		}
		case 'where_am_i': {
			const position = ctx.order.request.position;
			if (!position) return 'Todavía no se sabe dónde está: el GPS no ha dado la posición.';
			const label = await orsFor(ctx.k).whereIs(position);
			return label ? `Está en ${label}.` : 'No sé qué hay en ese punto.';
		}
		case 'take_photo':
			ctx.outcome.actions.push({ kind: 'photo' });
			return 'Foto hecha. Díselo en una palabra o dos.';
		case 'stop_navigation':
			ctx.outcome.actions.push({ kind: 'navigate', place: null });
			return 'Ruta quitada.';
		case 'add_to_shopping_list': {
			const items = Array.isArray(args.items)
				? args.items.filter((i: unknown): i is string => typeof i === 'string')
				: [];
			if (!items.length) return 'Falta qué añadir.';
			const added = await addItems(ctx.k, items.slice(0, 50));
			return added.length
				? `Añadido a la lista: ${added.join(', ')}.`
				: 'Ya estaba todo en la lista.';
		}
		case 'shopping_list': {
			const left = await toBuy(ctx.k);
			return left.length ? `En la lista: ${left.join(', ')}.` : 'La lista de la compra está vacía.';
		}
		case 'tick_off_shopping': {
			const wanted = typeof args.item === 'string' ? args.item : '';
			const done = wanted ? await tickOffByName(ctx.k, wanted) : null;
			return done ? `Tachado: ${done}.` : `«${wanted}» no está en la lista por comprar.`;
		}
		case 'add_expense': {
			if (kid) return 'Los gastos son cosa de los mayores.';
			const amount = args.amount === undefined || args.amount === null ? null : Number(args.amount);
			if (amount !== null && (!Number.isFinite(amount) || amount <= 0 || amount >= 1_000_000))
				return 'Importe no válido, en euros.';
			let total = amount === null ? null : Math.round(amount * 100);
			let what = typeof args.what === 'string' ? args.what.trim().slice(0, 120) : '';
			let category = isCategory(args.category) ? args.category : 'Otros';
			let lines: ExpenseLine[] = [];
			if (typeof args.favorite === 'string' && args.favorite.trim()) {
				const favorites = await favoriteExpenses(ctx.k);
				const asked = fold(args.favorite);
				const found =
					favorites.find((f) => fold(f.store) === asked) ??
					favorites.find((f) => fold(f.store).includes(asked) || asked.includes(fold(f.store)));
				if (!found)
					return favorites.length
						? `No hay un favorito «${args.favorite}». Los favoritos son: ${favorites.map((f) => f.store).join(', ')}.`
						: 'No hay gastos favoritos: se marcan en Gastos, con «☆ Guardar como favorito».';
				what = found.store;
				category = found.category;
				// Its lines only with its own amount: with another, they would not add up.
				if (total === null || total === found.total) lines = found.lines;
				total ??= found.total;
			}
			if (!what) return 'Falta en qué.';
			if (total === null) return `Falta cuánto, en euros: «${what}» no tiene importe guardado.`;
			await addExpense(ctx.k, { date: today(), store: what, category, total, lines }, 'voz');
			return `Apuntado en Gastos: ${what}, ${euros(total)} (${category}).`;
		}
		case 'add_event':
			if (kid) return 'La agenda la apuntan los mayores.';
			return addEventByVoice(ctx.k, args);
		case 'agenda':
			// A child, only theirs: by their name, as the family has them there.
			return agendaByVoice(ctx.k, args, kid ? ctx.order.who.name : null);
		case 'add_fridge_note': {
			const text = typeof args.text === 'string' ? args.text.trim() : '';
			if (!text) return 'Falta lo que dice el post-it.';
			const until = isUntilWord(args.until) ? untilDay(args.until) : null;
			await addNote(ctx.k, text, until);
			return `Post-it pegado en la nevera${until ? ` (${untilText(until)})` : ''}: «${text}».`;
		}
		case 'kitchen_mode':
			ctx.outcome.actions.push({ kind: 'kitchenMode', on: args.on !== false });
			return args.on !== false
				? 'Modo cocina encendido: la pantalla no se apaga.'
				: 'Modo cocina apagado.';
		// Where it is said (a satellite's), or for who speaks.
		case 'set_alarm':
			return setAlarmByVoice(ctx.k, args, ctx.place, !ctx.withoutHouse);
		case 'change_alarm':
			return changeAlarmByVoice(ctx.k, args, ctx.satellite);
		case 'start_recipe': {
			const recipe = parseRecipe(args);
			if (typeof recipe === 'string') return recipe;
			const step = Math.min(Math.max(Number(args.step) || 1, 1), recipe.steps.length);
			ctx.outcome.actions.push({ kind: 'recipe', recipe, step: step - 1 });
			return `Receta «${recipe.title}» en marcha en el dispositivo, en el paso ${step} de ${recipe.steps.length}.`;
		}
		case 'cook_saved_recipe': {
			const saved = await getRecipe(ctx.k, Number(args.id));
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
			const found = await searchRecipeSites(ctx.k, args.query, site, 6);
			return found.length
				? found.map((r) => `- ${r.title} (${r.site}): ${r.url}`).join('\n')
				: 'No hay ninguna con esas palabras en las webs favoritas.';
		}
		case 'cook_from_web': {
			const url = typeof args.url === 'string' ? args.url.trim() : '';
			// Only what the search found, not any address the model writes.
			if (!url || !(await isFavouritePage(ctx.k, url)))
				return 'Esa dirección no es de una web favorita: búscala antes con «search_recipe_sites».';
			const { id } = await importRecipe(ctx.k, url);
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

/**
 * What `find_places` found last, for each person (#312): «para en Horno San José» or «la segunda»
 * goes to that one, not to a search by its name. Forgotten after a while.
 */
/** How far ahead along the route `find_on_route` looks, if not said. */
const ON_ROUTE_KM = 50;

const lastFound = new Map<string, { until: number; places: FoundPlace[] }>();
const FOUND_FOR_MS = 15 * 60_000;

function keepFound(k: Kitchen, places: FoundPlace[]) {
	const now = Date.now();
	for (const [key, kept] of lastFound) if (kept.until < now) lastFound.delete(key);
	lastFound.set(`${k.familyId}:${k.userId}`, { until: now + FOUND_FOR_MS, places });
}

function foundPlace(k: Kitchen, said: string): Place | null {
	const kept = lastFound.get(`${k.familyId}:${k.userId}`);
	if (!kept || kept.until < Date.now()) return null;
	const place = findByName(kept.places, said);
	return place && { label: place.name, at: place.at };
}

/** A place said, by openrouteservice: the nearest to where we are first, if it is known. */
async function searchPlace(k: Kitchen, said: string, near: LngLat | null) {
	const [place] = await orsFor(k).searchPlaces(said, near);
	return place ?? null;
}

/**
 * The weather without the house: the place said, where the phone is (the road mode's GPS), or where
 * the family lives (Ajustes, «Dónde vivís»).
 */
async function cloudWeather(
	k: Kitchen,
	args: Record<string, unknown>,
	position: [number, number] | null
) {
	const asked = typeof args.place === 'string' ? args.place.trim() : '';
	let where: { lat: number; lon: number; name: string } | null = null;
	if (asked) {
		// «Toledo» is first in Ohio: one in Spain if there is one.
		const found = await findPlacesFor(k, asked, 10);
		const place = found.find((p) => p.country === 'España') ?? found[0];
		if (!place) return `No encuentro «${asked}». Díselo.`;
		where = { lat: place.lat, lon: place.lon, name: placeName(place) };
	} else if (position) {
		where = { lon: position[0], lat: position[1], name: 'donde está ahora' };
	} else {
		const home = await familyPlace(k);
		if (home) where = { lat: home.lat, lon: home.lon, name: placeName(home) };
	}
	if (!where)
		return 'No sé dónde está: pregúntale de qué pueblo o ciudad (se puede poner en Ajustes → Familia, «Dónde vivís»).';
	return `El tiempo en ${where.name}:\n${await forecast(where.lat, where.lon)}`;
}

/**
 * A timer said to the cloud (Hablar, the road mode): kept here, for who says it, on their phones
 * (a notice), or in the house if they say so (`house`).
 */
async function cloudTimer(name: string, args: Record<string, unknown>, ctx: Turn, me: string) {
	ctx.outcome.done++;
	if (name === 'cancel_timer') {
		const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim() : null;
		const count = await cancelTimers(ctx.k, me, label);
		return count ? `Quitados: ${count}.` : 'No había ninguno con ese nombre.';
	}
	const minutes = Number(args.minutes);
	if (!Number.isFinite(minutes) || minutes <= 0) return 'Falta cuántos minutos.';
	const seconds = Math.round(Math.min(minutes * 60, MAX_TIMER_SEC));
	const label = typeof args.label === 'string' ? args.label.trim().slice(0, 60) : '';
	const place = args.house === true ? 'casa' : 'movil';
	const timer = await startTimer(ctx.k, me, { label, seconds, place });
	return `Temporizador «${timer}» de ${seconds} segundos puesto: ${place === 'casa' ? 'sonará en toda la casa y avisará en su móvil' : 'avisará en su móvil'}.`;
}

/** One of Seilide's satellites' (#296): at its place, for anyone in the room. */
async function satelliteTimer(
	name: string,
	args: Record<string, unknown>,
	ctx: Turn,
	place: AlarmPlace
) {
	ctx.outcome.done++;
	if (name === 'cancel_timer') {
		const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim() : null;
		const count = await cancelTimersAt(ctx.k, place, label);
		return count ? `Quitados: ${count}.` : 'No había ninguno con ese nombre.';
	}
	const minutes = Number(args.minutes);
	if (!Number.isFinite(minutes) || minutes <= 0) return 'Falta cuántos minutos.';
	const seconds = Math.round(Math.min(minutes * 60, MAX_TIMER_SEC));
	const label = typeof args.label === 'string' ? args.label.trim().slice(0, 60) : '';
	const timer = await startTimerAt(ctx.k, place, { label, seconds });
	return `Temporizador «${timer}» de ${seconds} segundos puesto: suena aquí, en el satélite, con un «din-don» y su nombre.`;
}

/** Said to the cloud, «set_timer» can ring in the house too. */
const HOUSE_ARG = {
	house: {
		type: 'boolean',
		description:
			'Solo si dice que suene en casa («avísame en casa»): suena en toda la casa. Si no, avisa en su móvil.'
	}
};

/** The minute of the day now, in the family's time (TZ, compose.prod.yaml). */
function minuteNow() {
	const now = new Date();
	return now.getHours() * 60 + now.getMinutes();
}

/** The road mode (#78): what is said while driving. */
const CAR =
	'[En el coche, conduciendo (modo carretera): solo audio, aquí. Nunca vídeo: si pide una serie, una película o un canal de televisión, dile que en el coche no se pone vídeo (no que no lo encuentras) y ofrécele música, radio o un podcast. Respuestas muy cortas: las oye quien conduce.]';

/** Routes and where we are: only where there is a map and a GPS, the road mode. */
const ONLY_IN_THE_CAR = new Set([
	'navigate_to',
	'find_places',
	'find_on_route',
	'add_stop',
	'remove_stop',
	'where_am_i',
	'stop_navigation',
	'take_photo'
]);

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

/** As the AI would answer, for whoever asked: a satellite reads it aloud. */
const SAID_NO_KEY =
	'La familia no tiene clave de inteligencia artificial: ponla en Ajustes de Seilide, en «IA».';

/**
 * An order from the house, done: what the device must do, and the sentence to read aloud. `k`: the
 * family's kitchen in the name of who speaks (none, a satellite: anyone in the room).
 */
export async function runVoiceCommand(
	k: Kitchen,
	order: HouseVoiceOrder,
	/** Tools the device cannot do, not offered (the cloud's: no timers, no kitchen, no video yet). */
	without: string[] = [],
	/** Where it is said, for the AI, if it matters: what is not offered here, and why. */
	note: string | null = null,
	/** Said to the cloud: its timers kept here (`cloudTimer`), not the device's. */
	cloudTimers = false,
	/**
	 * False, without the house (`withoutHouse`, a family with none or one that does not answer):
	 * nothing of it is offered, and the order comes from here, not from it.
	 */
	withHouse = true
): Promise<VoiceReply & { timing: VoiceTiming }> {
	const started = performance.now();
	const { request, house, satellite } = order;
	const place: AlarmPlace | null =
		satellite && isAlarmPlace(`satelite:${satellite.id}`) ? `satelite:${satellite.id}` : null;
	// Where what it learns is kept (learned.ts): the satellite, or the person.
	const site = satellite ? `satelite:${satellite.id}` : k.userId ? `user:${k.userId}` : null;
	refreshStale(k);
	// Whose memory it sees: the person's and the house's; on a satellite, only the house's (memory.ts).
	const memoryOf = satellite ? null : k.userId;
	const kid = order.who.kid;
	const [
		apiKey,
		settings,
		recipes,
		sites,
		personStyle,
		me,
		group,
		learned,
		remembered,
		people,
		home
	] = await Promise.all([
		openRouterKey(k),
		voiceSettings(k),
		listRecipes(k),
		listRecipeSites(k),
		k.userId && !satellite ? personVoiceStyle(k, k.userId) : null,
		k.userId && !satellite ? personOf(k, k.userId) : null,
		botHasGroup(k.familyId),
		recallLearned(k, site, request.text),
		kid ? null : recallMemories(k, memoryOf, request.text),
		familyPeople(k),
		familyPlace(k)
	]);
	// Always there, short: who the family is and where it lives.
	const profile = people.length
		? `[La familia: ${people.map((p) => p.name).join(', ')}.${home ? ` Vivís en ${placeName(home)}.` : ''}]`
		: null;
	const timersOf = cloudTimers && !satellite ? me : null;
	const timersAt = cloudTimers && satellite ? place : null;
	// Said to the cloud by someone not among its people: no one to keep them for.
	if (cloudTimers && !timersOf && !timersAt) without = [...without, 'set_timer', 'cancel_timer'];
	if (!withHouse) without = [...without, ...ONLY_THE_HOUSE];
	const [alarmLines, timerLines] = await Promise.all([
		describeAlarms(k, me, house.satellites),
		timersOf ? describeTimersOf(k, timersOf) : request.timers
	]);
	const timing: VoiceTiming = { prepareMs: Math.round(performance.now() - started), rounds: [] };
	const outcome: Outcome = { actions: [], options: [], asked: null, done: 0, usedLearned: [] };
	const siteKey = site && `${k.familyId}:${site}`;
	const assumed = siteKey && assumedNote(siteKey);
	const reply = (text: string, expectsAnswer = false) => {
		// Only those the order has to do with: the model also says it of a «para».
		const used = (learned?.picked ?? []).filter(
			(l) => outcome.usedLearned.includes(l.id) && sharesWords(request.text, l)
		);
		// What was put on would be heard as the correction: then only with the word.
		const sounding = timing.rounds.some((r) => r.tools.some((t) => SOUNDING.has(t)));
		const said = {
			...replyOf(text, outcome, expectsAnswer),
			...(used.length && !expectsAnswer && !sounding ? { listenAfter: true } : {})
		};
		if (used.length)
			countHits(
				k,
				used.map((l) => l.id)
			);
		// The rules that wait for what is said (#331, phase 4): «cuando diga que pongo la lavadora».
		if (!kid) ruleEvent(k, 'dicho', request.text, satellite ? null : k.userId);
		// What it told on the way, learned (#331, phase 6), unless the order itself kept or forgot it.
		if (!kid && !timing.rounds.some((r) => r.tools.some((t) => ASKED_TO_KEEP.has(t))))
			void learnFromOrder(
				k,
				satellite ? null : k.userId,
				satellite ? null : order.who.name || null,
				request.text,
				text
			).catch((err) => console.warn('[voz] no se ha aprendido de lo hablado:', err));
		const answered = siteKey && afterOrder(siteKey, request.text, said, used);
		if (answered && apiKey && site)
			learnFrom(
				k,
				apiKey,
				site,
				satellite?.name ?? (order.who.name || 'Alguien de casa'),
				answered
			).catch((err) => console.warn('[voz] no se ha aprendido:', err));
		return { ...said, timing };
	};
	if (!apiKey) return reply(SAID_NO_KEY);

	const messages: ToolChatMessage[] = [
		{
			role: 'system',
			content: [
				{
					type: 'text',
					text: instructions({
						library: house.library,
						playlists: house.playlists,
						house: house.speakers,
						salon: house.salon,
						historyRules: house.historyRules,
						keepHistory: house.keepHistory,
						recipes,
						sites: sites.map(({ id, name, host }) => ({ id, name, host })),
						style: settings.style
					}),
					cache_control: { type: 'ephemeral' }
				}
			]
		},
		...request.history,
		{
			role: 'user',
			content: [
				{ type: 'text', text: `[${house.today}]` },
				{
					type: 'text',
					text: satellite
						? `[Te habla alguien de la casa desde «${satellite.name}», un satélite de voz sin pantalla: no sabes quién es, así que sin nombres; tampoco hay historial de lo que ve cada uno. ${satellite.ownSpeaker ? `La música y la radio de la casa suenan también en su altavoz: «aquí» es solo esta habitación; toda la casa si lo pide. Vídeos no: de un capítulo, solo el audio.` : 'El satélite no pone música, radio ni vídeos: aquí es toda la casa, y de un capítulo solo el audio.'} Los temporizadores y las alarmas que pongas desde aquí suenan donde contesta el satélite, con un «din-don» y su nombre, así que dales un nombre que se entienda al oírlo («pedir cita en la peluquería»); son de la casa, salvo que diga para quién.]`
						: `[Te habla: ${order.who.name}.${personStyle ? ` Cómo quiere que le hables (solo el tono, como el carácter de la casa): «${personStyle}».` : ''}]`
				},
				{ type: 'text', text: house.sounding },
				{
					type: 'text',
					text: satellite
						? `[Temporizadores y alarmas: ${[...house.timers, ...alarmLines].join('; ') || 'ninguno'}.]`
						: `[Temporizadores ${timersOf ? 'suyos' : 'aquí'}: ${timerLines.length ? timerLines.join('; ') : 'ninguno'}.] [Alarmas (de la casa y suyas; suenan en toda la casa o en un satélite): ${alarmLines.length ? alarmLines.join('; ') : 'ninguna'}.]`
				},
				...(request.recipe
					? [{ type: 'text' as const, text: `[Receta en marcha aquí:\n${request.recipe}]` }]
					: []),
				...(house.watching ? [{ type: 'text' as const, text: house.watching }] : []),
				...(request.car
					? [
							{ type: 'text' as const, text: CAR },
							{
								type: 'text' as const,
								text: `[Ruta: ${request.navigation ?? 'ninguna'}.]`
							}
						]
					: []),
				...(note ? [{ type: 'text' as const, text: note }] : []),
				...(learned ? [{ type: 'text' as const, text: learned.text }] : []),
				...(assumed ? [{ type: 'text' as const, text: assumed }] : []),
				...(profile ? [{ type: 'text' as const, text: profile }] : []),
				...(remembered ? [{ type: 'text' as const, text: remembered }] : []),
				{ type: 'text', text: request.text }
			]
		}
	];
	const available = [
		...tools(house.speakers, house.rooms, house.salon, house.clipMinutes),
		...(house.tools as Tool[]),
		...(group ? [groupSayTool] : []),
		messageTool,
		...(kid ? [] : ruleTools(Boolean(satellite))),
		...(kid || satellite ? [] : [markDoseTool]),
		...(learned ? [usedLearnedTool] : []),
		...(kid ? [] : memoryTools(Boolean(satellite))),
		...(settings.web.on ? [webSearchTool] : [])
	]
		.map((t) =>
			timersOf && withHouse && t.function.name === 'set_timer'
				? {
						...t,
						function: {
							...t.function,
							parameters: {
								...t.function.parameters,
								properties: { ...(t.function.parameters.properties as object), ...HOUSE_ARG }
							}
						}
					}
				: t
		)
		.filter(
			(t) =>
				!without.includes(t.function.name) &&
				(request.car ? !NOT_IN_THE_CAR.has(t.function.name) : !ONLY_IN_THE_CAR.has(t.function.name))
		);
	available.push(answerTool);
	const turn: Turn = {
		k,
		order,
		outcome,
		recipe: request.recipe,
		satellite: Boolean(satellite),
		place,
		timersOf,
		timersAt,
		apiKey,
		settings,
		houseTools: new Set(house.tools.map((t) => t.function.name)),
		withoutHouse: !withHouse,
		memoryOf
	};

	for (let round = 0; round < MAX_ROUNDS; round++) {
		const asked = performance.now();
		let answer: Awaited<ReturnType<typeof chatWithTools>>;
		try {
			answer = await chatWithTools({
				apiKey,
				label: `Voz: «${request.text}»`,
				model: settings.model,
				fallbackModel: FALLBACK_VOICE_MODEL,
				messages,
				tools: available,
				think: false,
				toolChoice: 'required'
			});
			if (answer.fellBack) voiceFellBack(k.familyId, answer.fellBack);
		} catch (err) {
			if (err instanceof Error && err.message === NO_CREDIT) return reply(SAID_NO_CREDIT);
			throw err;
		}
		timing.rounds.push({
			ms: Math.round(performance.now() - asked),
			prompt: answer.usage?.prompt_tokens ?? 0,
			cached: answer.usage?.prompt_tokens_details?.cached_tokens ?? 0,
			completion: answer.usage?.completion_tokens ?? 0,
			tools: answer.toolCalls.map((c) => c.function.name)
		});
		// Text instead of its `answer` (a model that ignores `required`, or asked without it, as
		// Haiku 5.5 since 2026-10-29): said, and awaited only if it asks with a «?».
		if (!answer.toolCalls.length)
			return reply(answer.content ?? 'Hecho.', answer.content?.includes('?') ?? false);
		const calls = answer.toolCalls.filter((c) => !noteUsedLearned(c, outcome));
		const [only] = calls;
		if (calls.length === 1 && only!.function.name === 'answer') {
			let args: { text?: unknown; expects_answer?: unknown } = {};
			try {
				args = JSON.parse(only!.function.arguments || '{}');
			} catch {
				// Unreadable: «Hecho.», as with no text.
			}
			const text = typeof args.text === 'string' && args.text.trim() ? args.text : 'Hecho.';
			return reply(text, args.expects_answer === true);
		}
		messages.push({ role: 'assistant', content: answer.content, tool_calls: answer.toolCalls });
		// Each call done gives the device something to do; a failed one says why, and gives nothing.
		const said: string[] = [];
		let oneRound = true;
		for (const call of answer.toolCalls) {
			// Noted above: nothing to do.
			if (call.function.name === 'used_learned') {
				messages.push({ role: 'tool', tool_call_id: call.id, content: 'Anotado.' });
				continue;
			}
			const before = outcome.actions.length + outcome.done;
			let result: ToolResult;
			// With others, before knowing what they did: given again after their results.
			if (call.function.name === 'answer') {
				messages.push({
					role: 'tool',
					tool_call_id: call.id,
					content: 'Aún no: contesta con «answer» sola, después de ver lo que han hecho las demás.'
				});
				continue;
			}
			try {
				const args = JSON.parse(call.function.arguments || '{}');
				if (typeof args.say === 'string' && args.say.trim()) said.push(args.say.trim());
				else oneRound = false;
				result = await runTool(call.function.name, args, turn);
			} catch (err) {
				result = `Error: ${err instanceof Error ? err.message : String(err)}`;
			}
			messages.push({ role: 'tool', tool_call_id: call.id, content: result });
			if (!ONE_ROUND.has(call.function.name) || outcome.actions.length + outcome.done === before)
				oneRound = false;
		}
		if (outcome.asked) return reply(outcome.asked, true);
		if (oneRound && said.length) return reply(said.join(' '));
	}
	// Nothing done: listened to again, to say it another way.
	const done = outcome.actions.length + outcome.done > 0;
	return reply(done ? 'Hecho.' : 'No he sabido hacerlo. Dímelo de otra forma.', !done);
}

/** A `used_learned` call: its numbers noted in `outcome`. */
function noteUsedLearned(
	call: { function: { name: string; arguments: string } },
	outcome: Outcome
) {
	if (call.function.name !== 'used_learned') return false;
	try {
		const { ids } = JSON.parse(call.function.arguments || '{}');
		if (Array.isArray(ids))
			for (const id of ids) if (Number.isInteger(id)) outcome.usedLearned.push(id);
	} catch {
		// Unreadable: as if not said.
	}
	return true;
}

const replyOf = (text: string, outcome: Outcome, expectsAnswer: boolean): VoiceReply => ({
	reply: text.trim(),
	actions: outcome.actions,
	options: outcome.options,
	expectsAnswer
});

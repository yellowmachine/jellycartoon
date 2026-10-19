import path from 'node:path';
import { eq } from 'drizzle-orm';
import { MPV_SOCKET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { movie, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { hostCinemaRoot } from '#lib/server/library/paths.ts';
import { inOrder } from '#lib/server/in-order.ts';
import { log } from '#lib/server/log.ts';
import { MpvClient, StateBroadcast, type MpvMessage } from '#lib/server/mpv-client.ts';
import { saveProgress } from '#lib/server/progress.ts';
import { addWatchTime } from '#lib/server/watch-time.ts';
import { videoAllowed } from '#lib/server/kid-time.ts';
import { noteAsking, noteStopped, noteTouched } from '#lib/server/live-watching.ts';
import { askEvery } from '#lib/server/still-there.ts';
import { ANSWER_SECONDS, QUESTION } from '#lib/still-there.ts';
import type { Channel } from '#lib/channels.ts';
import type { RemoteAction, RemoteState, Track } from '#lib/salon.ts';
import { mpvSubtitleProperties, type SubtitleStyle } from '#lib/subtitle-style.ts';

/**
 * Plays films, episodes and TV channels on the host's screen: an mpv left waiting at MPV_SOCKET
 * (deploy/jellycartoon-mpv.service). Also the remote control: what mpv is doing, live, and
 * commands to change it.
 */

export const mpvEnabled = Boolean(MPV_SOCKET);

/** WebVTT files to add by hand: an episode's (outside its HLS playlist), a film's made ones. */
type ExtraSubtitles = { path: string; lang: string; label: string }[];

/** A film (its own subtitles are inside its file), or an episode. */
export type Target =
	{ movieId: number; subtitles: ExtraSubtitles } | { episodeId: number; subtitles: ExtraSubtitles };

/** Something to play, in the order it is queued. */
export interface QueueItem {
	target: Target;
	title: string;
	/** Above the title, e.g. the series and episode number. */
	subtitle: string | null;
	/** The file's path on the host, which is where mpv runs. */
	hostPath: string;
	startSec: number;
	durationSec: number | null;
}

/**
 * Who is watching what, by mpv's playlist entry id. Kept while the entry is in mpv's playlist, which
 * can go back to it, and until the last events of a replaced one.
 */
interface Playing extends QueueItem {
	userId: string;
	positionSec: number;
	subtitlesAdded?: boolean;
	/** Replaced by a new queue: forgotten once it ends. */
	replaced?: boolean;
}

const playing = new Map<number, Playing>();
/** Cine Club intros queued before a film: the film's title, by playlist entry id. */
const intros = new Map<number, string>();
/**
 * TV channels, live, by playlist entry id: no progress to save, only a child's time (counted from
 * how far the position moves, as with the rest).
 */
interface Live {
	channel: Channel;
	userId: string;
	positionSec: number | null;
}
const live = new Map<number, Live>();
/** Played by the app (a film, its intro, a channel), as opposed to something opened in mpv by hand. */
const ours = (entryId: number | null) =>
	entryId !== null && (playing.has(entryId) || intros.has(entryId) || live.has(entryId));
/** The entry on screen now. */
let current: number | null = null;
/** The entry whose file mpv has finished opening (`file-loaded`): tracks can be added to it. */
let loaded: number | null = null;

const state: RemoteState = {
	available: false,
	active: false,
	movieId: null,
	episodeId: null,
	title: null,
	subtitle: null,
	intro: false,
	live: false,
	playlistPos: null,
	playlistCount: null,
	paused: false,
	positionSec: null,
	durationSec: null,
	volume: null,
	audioId: null,
	subtitleId: null,
	tracks: [],
	failed: null,
	voiceKey: 0
};

const SAVE_MS = 5_000;
let saveTimer: ReturnType<typeof setInterval> | null = null;

/** mpv properties the remote follows; changes arrive as `property-change` events. */
const OBSERVED = [
	'idle-active',
	'path',
	'pause',
	'time-pos',
	'duration',
	'volume',
	'aid',
	'sid',
	'track-list',
	'media-title',
	'playlist-pos',
	'playlist-count'
];

// Every open /salon page and salon bar gets the state as it changes.
const remotes = new StateBroadcast(state);
const notify = (positionOnly = false) => remotes.notify(positionOnly);

const mpv = new MpvClient(
	MPV_SOCKET ?? '',
	OBSERVED,
	{
		onConnect() {
			state.available = true;
			notify();
		},
		// mpv was closed (or restarted): whatever was playing keeps its last known position.
		onClose() {
			if (question) clearTimeout(question.timer);
			question = null;
			for (const entry of playing.values()) void save(entry, false);
			playing.clear();
			intros.clear();
			live.clear();
			current = null;
			loaded = null;
			stopSaving();
			Object.assign(state, { available: false, ...NOTHING });
			notify();
		},
		onProperty: (name, data) => propertyChanged(name, data),
		onEvent: (message: MpvMessage) => {
			const entryId = message.playlist_entry_id;
			if (message.event === 'start-file' && entryId !== undefined) {
				current = entryId;
				showFailed(null);
				show(entryId);
				void startedByItself(entryId);
			} else if (message.event === 'file-loaded') {
				loaded = current;
				loadedAt = Date.now();
				if (loaded !== null) void addSubtitles(loaded);
			} else if (message.event === 'end-file' && entryId !== undefined) {
				if (message.reason === 'error') failedToOpen(entryId, message.file_error);
				// Stopped (Volver, Inicio) while asking: no question left on the next one.
				const asked = entryId === current ? clearQuestion() : null;
				if (asked) noteAsking(asked, false);
				void ended(entryId, message.reason ?? '');
			} else if (message.event === 'seek' && Date.now() - loadedAt > OWN_START_MS) {
				someoneThere();
			} else if (message.event === 'client-message') {
				const [name] = message.args ?? [];
				if (name === VOICE_MESSAGE) {
					someoneThere();
					state.voiceKey++;
					notify();
				} else if (name === KEY_MESSAGE) someoneThere();
				else if (name === STILL_HERE_MESSAGE) answered();
			}
		}
	},
	'mpv no está esperando en el salón: ¿está arrancado jellycartoon-mpv?',
	() => remotes.size > 0
);
const command = (cmd: unknown) => mpv.command(cmd);

/** `script-message` of the remote's microphone key, in deploy/mpv/input.conf. */
const VOICE_MESSAGE = 'jellycartoon-voz';
/** mando.lua's: its menu opened (someone is there), or its OK answering «¿Sigues ahí?». */
const KEY_MESSAGE = 'jellycartoon-tecla';
const STILL_HERE_MESSAGE = 'jellycartoon-sigo';
/** Read by mando.lua: while true, OK answers «¿Sigues ahí?» instead of opening its menu. */
const ASKING_PROPERTY = 'user-data/jellycartoon/asking';
/** Seeks this soon after a file opens are its own start (`start=`), not someone touching it. */
const OWN_START_MS = 5000;

/**
 * «¿Sigues ahí?» (#77). Episodes mpv's list started by itself since anyone last touched anything:
 * a key of the remote (a seek, Play/Pausa, the menu, the microphone) or the phone's remote.
 */
let unattended = 0;
/** The first of the queue, started by whoever chose it: not by itself. */
let queueFirst: number | null = null;
/** Asked and not answered: whom, and the stop when time is up. */
let question: { userId: string; timer: ReturnType<typeof setTimeout> } | null = null;
/** When the file on screen opened. */
let loadedAt = 0;

/** Someone touched something: the count starts again, and a question is answered. */
function someoneThere() {
	unattended = 0;
	const userId = current === null ? undefined : (playing.get(current) ?? live.get(current))?.userId;
	if (userId) noteTouched(userId);
	answered();
}

/** Each one mpv's list starts by itself counts; at this user's number of them, it asks. */
async function startedByItself(entryId: number) {
	const entry = playing.get(entryId);
	if (!entry || entryId === queueFirst || question) return;
	unattended++;
	const every = await askEvery(entry.userId).catch(() => null);
	if (!every || unattended < every || current !== entryId) return;
	question = {
		userId: entry.userId,
		timer: setTimeout(() => void nobodyAnswered(), ANSWER_SECONDS * 1000)
	};
	noteAsking(entry.userId, true);
	log.info('mpv', `${QUESTION} Tras ${unattended} capítulos seguidos`, { userId: entry.userId });
	try {
		await command(['set_property', 'pause', true]);
		await command(['set_property', ASKING_PROPERTY, true]);
		await command(['show-text', `${QUESTION}\nPulsa OK para seguir`, ANSWER_SECONDS * 1000]);
	} catch (error) {
		log.warn('mpv', `No se pudo preguntar «${QUESTION}»`, { error });
	}
}

/** No question any more (answered, stopped or gone): whom it was for. */
function clearQuestion() {
	if (!question) return null;
	clearTimeout(question.timer);
	const { userId } = question;
	question = null;
	void command(['set_property', ASKING_PROPERTY, false]).catch(() => {});
	void command(['show-text', '', 1]).catch(() => {});
	return userId;
}

/** «Sigo aquí»: OK, Play/Pausa, or anything else. It plays again. */
function answered() {
	const userId = clearQuestion();
	if (!userId) return;
	unattended = 0;
	noteAsking(userId, false);
	void command(['set_property', 'pause', false]).catch(() => {});
	log.info('mpv', 'Sigue ahí', { userId });
}

/** Time is up: it stops, and /infantil's «Ahora» says why. */
async function nobodyAnswered() {
	const userId = clearQuestion();
	if (!userId) return;
	noteStopped(userId);
	log.info('mpv', `Nadie contestó a «${QUESTION}»: parado`, { userId });
	await command(['stop']).catch(() => {});
	// mpv's pause is the player's, not the file's: what is put on next would start paused.
	await command(['set_property', 'pause', false]).catch(() => {});
}
/** A message stays this long at most: the one who wrote it takes it away before. */
const MESSAGE_MS = 60_000;

interface MpvTrack {
	id: number;
	type: string;
	lang?: string;
	title?: string;
	forced?: boolean;
	'demux-channel-count'?: number;
}

/** What the remotes show while nothing of ours is on. */
const NOTHING = {
	active: false,
	movieId: null,
	episodeId: null,
	title: null,
	subtitle: null,
	intro: false,
	live: false
} satisfies Partial<RemoteState>;

/**
 * The remotes show the entry now on screen: one of ours, its intro, a channel, or a file opened by
 * hand.
 */
function show(entryId: number) {
	const entry = playing.get(entryId);
	const introOf = intros.get(entryId);
	const channel = live.get(entryId)?.channel.name;
	Object.assign(state, {
		active: true,
		movieId: entry && 'movieId' in entry.target ? entry.target.movieId : null,
		episodeId: entry && 'episodeId' in entry.target ? entry.target.episodeId : null,
		title: entry?.title ?? introOf ?? channel ?? state.title,
		subtitle: entry?.subtitle ?? (channel ? 'En directo' : null),
		intro: introOf !== undefined,
		live: channel !== undefined
	});
	notify();
}

/** An entry that failed before it was known as ours. */
let failedEarly: { entryId: number; error: string | undefined } | null = null;

/** Now that `entryId` is known: if it already failed, said now. */
function checkFailedEarly(entryId: number) {
	if (failedEarly?.entryId !== entryId) return;
	const { error } = failedEarly;
	failedEarly = null;
	failedToOpen(entryId, error);
}

/** How long the remotes say what could not be opened, unless something plays before. */
const FAILED_MS = 30_000;
let failedTimer: ReturnType<typeof setTimeout> | undefined;

function showFailed(text: string | null) {
	clearTimeout(failedTimer);
	if (state.failed === text) return;
	state.failed = text;
	if (text) failedTimer = setTimeout(() => showFailed(null), FAILED_MS);
	notify();
}

/**
 * One of ours that mpv could not open: a channel off the air, a file that is gone… Without this it
 * would only go back to nothing, as if it had ended. Not the intro: the film goes on after it.
 */
function failedToOpen(entryId: number, error: string | undefined) {
	const name = playing.get(entryId)?.title ?? live.get(entryId)?.channel.name;
	// Its end may come before loadfile's answer, as start-file does: told once it is known.
	if (!name) return void (failedEarly = { entryId, error });
	log.warn('mpv', `No se pudo abrir ${name}`, { error });
	showFailed(`No se pudo abrir ${name}`);
}

/** Only the one in the user's language is selected; none when they want no subtitles. */
let preferredSubtitle: string | null = null;

/** Once per entry, when both its file is open and the entry is known (whichever comes last). */
async function addSubtitles(entryId: number) {
	const entry = playing.get(entryId);
	if (!entry || !('subtitles' in entry.target) || entry.subtitlesAdded || loaded !== entryId)
		return;
	entry.subtitlesAdded = true;
	let selected = false;
	for (const sub of entry.target.subtitles) {
		const select: boolean = !selected && sub.lang === preferredSubtitle;
		selected ||= select;
		await command(['sub-add', sub.path, select ? 'select' : 'auto', sub.label, sub.lang]).catch(
			(error) => log.warn('mpv', `No se pudieron añadir los subtítulos ${sub.path}`, { error })
		);
	}
}

function propertyChanged(name: string, data: unknown) {
	const number = typeof data === 'number' ? data : null;
	switch (name) {
		// Sent as soon as it is observed too: right after connecting, the remote already knows whether
		// something was playing (e.g. the app restarted mid-film).
		case 'idle-active':
			if (data !== false) {
				Object.assign(state, { ...NOTHING, positionSec: null });
				stopSaving();
			} else state.active = true;
			break;
		case 'path':
			if (typeof data === 'string' && !ours(current)) void identify(data);
			return;
		case 'pause':
			state.paused = data === true;
			// Play/Pausa: someone is there, and with a question, it answers it.
			if (data === false || !question) someoneThere();
			break;
		case 'time-pos': {
			state.positionSec = number;
			const entry = current !== null ? (playing.get(current) ?? live.get(current)) : undefined;
			if (entry && number !== null) entry.positionSec = number;
			// Many per second: the remotes get it once a second at most.
			notify(true);
			return;
		}
		case 'duration': {
			state.durationSec = number;
			// Episodes not probed yet still count as watched at the end.
			const entry = current !== null ? playing.get(current) : undefined;
			if (entry && !entry.durationSec) entry.durationSec = number;
			break;
		}
		case 'playlist-pos':
			state.playlistPos = number !== null && number >= 0 ? number + 1 : null;
			break;
		case 'playlist-count':
			state.playlistCount = number;
			break;
		case 'volume':
			state.volume = number;
			break;
		case 'aid':
			state.audioId = number;
			break;
		case 'sid':
			state.subtitleId = number;
			break;
		case 'track-list': {
			// A channel has the same audio once per quality (RTVE: Spanish four times): one is enough.
			const channelOn = current !== null && live.has(current);
			const seen = new Set<string>();
			state.tracks = ((data as MpvTrack[] | null) ?? [])
				.filter((t) => t.type === 'audio' || t.type === 'sub')
				.filter((t) => {
					if (!channelOn) return true;
					const key = [t.type, t.lang, t.title, t['demux-channel-count']].join('|');
					if (seen.has(key)) return false;
					seen.add(key);
					return true;
				})
				.map((t) => ({
					id: t.id,
					type: t.type as Track['type'],
					lang: t.lang ?? null,
					title: t.title ?? null,
					forced: Boolean(t.forced),
					channels: t['demux-channel-count'] ?? null
				}));
			break;
		}
		case 'media-title':
			// What the app plays (and the intro) keeps its catalogue title.
			if (!ours(current)) state.title = (data as string) ?? null;
			break;
	}
	notify();
}

/** A film already playing when the app connected: its catalogue title, if it is one of ours. */
async function identify(hostPath: string) {
	const relative = hostCinemaRoot ? path.relative(hostCinemaRoot, hostPath) : null;
	if (!relative || relative.startsWith('..')) return;
	const [film] = await db
		.select({ id: movie.id, title: movieTitle })
		.from(movie)
		.where(eq(movie.path, relative))
		.catch(() => []);
	if (!film) return;
	Object.assign(state, { movieId: film.id, title: film.title });
	notify();
}

/** `eof`: it reached the end. `stop`: another film replaced it, or it was stopped by hand. */
async function ended(entryId: number, reason: string) {
	const entry = playing.get(entryId);
	if (!entry) return;
	if (entry.replaced) playing.delete(entryId);
	if (current === entryId) current = null;
	await save(entry, reason === 'eof');
}

/** Past 92% (end credits) counts as watched, and the next time starts from the beginning. */
async function save(entry: Playing, reachedEnd: boolean) {
	const completed =
		reachedEnd || Boolean(entry.durationSec && entry.positionSec / entry.durationSec > 0.92);
	await addWatchTime(entry.userId, entry.target, entry.positionSec, 'salon', 'el salón');
	if ('episodeId' in entry.target) {
		const { episodeId } = entry.target;
		// Also ticks it off today's playlist and the user's lists.
		return saveProgress(entry.userId, episodeId, entry.positionSec, completed).catch((error) =>
			log.error('mpv', 'No se pudo guardar el progreso', { episodeId, error })
		);
	}
	const values = {
		userId: entry.userId,
		movieId: entry.target.movieId,
		positionSec: completed ? 0 : entry.positionSec,
		completed,
		updatedAt: new Date()
	};
	await db
		.insert(movieProgress)
		.values(values)
		.onConflictDoUpdate({ target: [movieProgress.userId, movieProgress.movieId], set: values })
		.catch((error) => log.error('mpv', 'No se pudo guardar el progreso', { ...values, error }));
}

function startSaving() {
	saveTimer ??= setInterval(() => {
		const entry = current !== null ? playing.get(current) : undefined;
		if (entry) void save(entry, false).then(() => stopIfClosed(entry.userId));
		const channel = current !== null ? live.get(current) : undefined;
		if (channel?.positionSec != null)
			void addWatchTime(
				channel.userId,
				{ channelId: channel.channel.id },
				channel.positionSec,
				'salon',
				'el salón'
			).then(() => stopIfClosed(channel.userId));
	}, SAVE_MS);
	saveTimer.unref();
}

/** A child's time is over (#18): what plays stops, with what was watched already saved. */
async function stopIfClosed(userId: string) {
	try {
		if ((await videoAllowed(userId)).allowed) return;
		log.info('mpv', 'Parado: se acabó el tiempo de vídeo de una cuenta infantil', { userId });
		await command(['stop']);
	} catch (error) {
		log.warn('mpv', 'No se pudo comprobar el horario infantil', { error });
	}
}

function stopSaving() {
	if (saveTimer) clearInterval(saveTimer);
	saveTimer = null;
}

/** Calls `listener` with the current state and on every change; returns the unsubscribe. */
export function watchRemote(listener: (state: RemoteState) => void) {
	const unwatch = remotes.watch(listener);
	mpv.connect().catch(() => mpv.keepTrying());
	return unwatch;
}

export async function control(remote: RemoteAction) {
	// The phone's remote: someone is there. Not its text over the picture (the voice's own).
	if (remote.action !== 'stop' && remote.action !== 'message') someoneThere();
	switch (remote.action) {
		case 'pause':
			return command(['set_property', 'pause', remote.value]);
		case 'seek':
			return command(['seek', remote.value, 'relative']);
		case 'seekTo':
			return command(['seek', remote.value, 'absolute']);
		case 'volume':
			return command(['set_property', 'volume', remote.value]);
		case 'audio':
			return command(['set_property', 'aid', remote.value]);
		case 'subtitle':
			return command(['set_property', 'sid', remote.value ?? 'no']);
		case 'next':
			return command(['playlist-next']);
		case 'previous':
			return command(['playlist-prev']);
		case 'stop':
			return command(['stop']);
		case 'message':
			return command(['show-text', remote.value, remote.value ? MESSAGE_MS : 1]);
	}
}

/**
 * One order to play at a time: each one is several commands to mpv, and two at once (OK pressed
 * twice) would mix their queues. The second waits for the first, and then replaces it whole.
 */
const oneOrder = inOrder();

/** What was queued goes: what ended is already saved, and what is on saves when it ends. */
function forgetQueue() {
	// Chosen now: started by someone, and no question for what was on.
	unattended = 0;
	queueFirst = null;
	const asked = clearQuestion();
	if (asked) noteAsking(asked, false);
	intros.clear();
	live.clear();
	for (const [id, entry] of playing) {
		if (id === current) entry.replaced = true;
		else playing.delete(id);
	}
}

/**
 * Opens what is queued full screen on the host, replacing whatever was playing; mpv moves on to the
 * next item by itself. With `intro`, the Cine Club intro goes first.
 */
export function play(options: Parameters<typeof playNow>[0]) {
	return oneOrder(() => playNow(options));
}

async function playNow(options: {
	userId: string;
	items: QueueItem[];
	/** ISO 639-2 codes, as tagged in the tracks. */
	audioLang: string | null;
	subtitleLang: string | null;
	/** How whoever plays it sees subtitles (Ajustes): mpv is shared, so set at every play. */
	subtitleStyle: SubtitleStyle;
	/** The intro's path on the host. */
	intro: string | null;
}) {
	preferredSubtitle = options.subtitleLang;
	forgetQueue();
	noteTouched(options.userId);
	// Chosen now, to watch now: mpv's pause outlives what was paused (Volver while paused).
	await command(['set_property', 'pause', false]).catch(() => {});
	for (const [name, value] of mpvSubtitleProperties(options.subtitleStyle))
		await command(['set_property', name, value]).catch((error) =>
			log.warn('mpv', `No se pudo poner ${name} de los subtítulos`, { value, error })
		);
	let first = true;
	if (options.intro) {
		const intro = (await command({
			name: 'loadfile',
			url: options.intro,
			flags: 'replace'
		})) as { playlist_entry_id: number };
		intros.set(intro.playlist_entry_id, options.items[0].title);
		// start-file may have arrived before the entry was known.
		if (current === intro.playlist_entry_id) show(intro.playlist_entry_id);
		first = false;
	}
	for (const item of options.items) {
		// Options given to loadfile are the file's own: each item starts where it was left.
		const mpvOptions: Record<string, string> = { start: String(Math.floor(item.startSec)) };
		if (options.audioLang) mpvOptions.alang = options.audioLang;
		// Extra .vtt files (an episode's, a film's made ones) are added once loaded (addSubtitles).
		if (options.subtitleLang && 'movieId' in item.target) mpvOptions.slang = options.subtitleLang;
		const result = (await command({
			name: 'loadfile',
			url: item.hostPath,
			// append-play: it still plays if the intro could not be opened.
			flags: first ? 'replace' : 'append-play',
			options: mpvOptions
		})) as { playlist_entry_id: number };
		queueFirst ??= result.playlist_entry_id;
		first = false;
		playing.set(result.playlist_entry_id, {
			...item,
			userId: options.userId,
			positionSec: item.startSec
		});
		if (current === result.playlist_entry_id) show(result.playlist_entry_id);
		checkFailedEarly(result.playlist_entry_id);
		void addSubtitles(result.playlist_entry_id);
	}
	startSaving();
	log.info(
		'mpv',
		`Reproduciendo ${options.items[0].hostPath} desde ${Math.floor(options.items[0].startSec)} s`,
		{ more: options.items.length - 1, intro: Boolean(options.intro) }
	);
}

/** A TV channel, live, full screen on the host: replacing whatever was playing. */
export function playChannel(userId: string, channel: Channel) {
	return oneOrder(() => playChannelNow(userId, channel));
}

async function playChannelNow(userId: string, channel: Channel) {
	forgetQueue();
	noteTouched(userId);
	await command(['set_property', 'pause', false]).catch(() => {});
	const result = (await command({ name: 'loadfile', url: channel.url, flags: 'replace' })) as {
		playlist_entry_id: number;
	};
	live.set(result.playlist_entry_id, { channel, userId, positionSec: null });
	if (current === result.playlist_entry_id) show(result.playlist_entry_id);
	checkFailedEarly(result.playlist_entry_id);
	startSaving();
	log.info('mpv', `En directo: ${channel.name}`, { url: channel.url });
}

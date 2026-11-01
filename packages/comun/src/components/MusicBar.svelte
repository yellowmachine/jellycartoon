<script lang="ts">
	import { page } from '$app/state';
	import MediaIcon from './MediaIcon.svelte';
	import PlayModes from './PlayModes.svelte';
	import { untrack } from 'svelte';
	import type Hls from 'hls.js';
	import { formatDuration } from '../format.ts';
	import { GAVE_UP, RETRYING, TRIES, recoverFromErrors, retryDelay } from '../hls-recovery.ts';
	import { dj } from '../dj.svelte.ts';
	import { audioUrl, coverUrl, heldHere, stopTime, type MusicTrack } from '../music.ts';
	import { music } from '../music-player.svelte.ts';
	import { musicQuality } from '../music-quality.svelte.ts';
	import { keepQueue } from '../music-queue.svelte.ts';
	import { keepPodcastProgress, podcastEnded } from '../podcast-player.svelte.ts';
	import { keepListeningProgress, listeningEnded } from '../episode-listening.svelte.ts';
	import { SKIP_BACK, SKIP_FORWARD, SPEEDS, type Speed } from '../podcasts.ts';
	import { COUNTRIES } from '../radio.ts';
	import {
		noteAutoResume,
		noteHandoff,
		noteSystemAction,
		watchMedia,
		watchPlay
	} from '../media-diagnostics.ts';
	import { FINE_AFTER_MS, shouldResume } from '../auto-resume.ts';

	/**
	 * Two `<audio>` that take turns (#180): the one that sounds, and the next song loading in the
	 * other, which starts just before this one ends. The page is never silent between two songs:
	 * with the screen off, that is when the phone used to pause the next one (seen on walks, always
	 * at a song change). Everything else only knows `audio`, the one that sounds.
	 */
	let players = $state<HTMLAudioElement[]>([]);
	let active = $state(0);
	const audio = $derived(players[active]);
	const spare = $derived(players[1 - active]);
	const current = $derived(music.current);
	const radio = $derived(music.radio);
	const podcast = $derived(music.podcast);
	const listening = $derived(music.listening);
	let hls: Hls | null = null;
	/** A station off the air or a dropped connection, said while it is tried again. */
	let problem = $state<string | null>(null);
	/** Reconnections of a station played as is (not HLS) since it last played. */
	let tries = 0;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	/** The queue, open under the bar: what is on, what comes next and what already played. */
	let showQueue = $state(false);
	let queueList = $state<HTMLElement>();

	// Opened: the one on in view, not the start of a long queue.
	$effect(() => {
		if (showQueue) queueList?.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' });
	});

	keepQueue();
	keepPodcastProgress();
	keepListeningProgress();

	/** The speed chosen for podcasts, kept in this browser. */
	const SPEED_KEY = 'podcast-speed';
	$effect(() => {
		try {
			const saved = Number(localStorage.getItem(SPEED_KEY));
			if (SPEEDS.includes(saved as Speed)) music.speed = saved as Speed;
		} catch {
			// Private windows.
		}
	});

	function nextSpeed() {
		music.speed = SPEEDS[(SPEEDS.indexOf(music.speed) + 1) % SPEEDS.length]!;
		try {
			localStorage.setItem(SPEED_KEY, String(music.speed));
		} catch {
			// Same.
		}
	}

	/** «1,25×», as it is written in Spanish. */
	const speedLabel = (speed: number) => `${String(speed).replace('.', ',')}×`;

	// Podcasts at the chosen speed (talk keeps its pitch); music as it is. Loading a new `src`
	// goes back to defaultPlaybackRate, so both.
	$effect(() => {
		if (!audio) return;
		const rate = podcast || listening ? music.speed : 1;
		audio.defaultPlaybackRate = rate;
		audio.playbackRate = rate;
	});

	/**
	 * The `<audio>` failed with its own `src` (hls.js handles its own): it is tried again, a few
	 * times and each a little later. A station connects again; a track or an episode is loaded
	 * again from where it was. Brought back from the server and not played yet, it only says so:
	 * play loads it again.
	 */
	function failed() {
		if (hls || !audio?.getAttribute('src')) return;
		clearTimeout(retryTimer);
		const gaveUp = radio
			? GAVE_UP
			: podcast || listening
				? 'No se pudo reproducir este episodio.'
				: 'No se pudo reproducir esta canción.';
		// A song not kept here, without coverage most likely: on to the next one kept (#350).
		const song = !radio && !podcast && !listening ? music.current : null;
		if (
			song &&
			!music.restored &&
			!song.clip &&
			!heldHere(song.id) &&
			music.nextWhere((t) => heldHere(t.id))
		) {
			tries = 0;
			problem = null;
			return;
		}
		if (tries >= TRIES || music.restored) return void (problem = gaveUp);
		tries++;
		problem = RETRYING;
		retryTimer = setTimeout(retry, retryDelay(tries));
	}

	function retry() {
		if (radio) music.resume();
		else music.retry();
	}

	/** The connection is back: tried again now, not when its wait ends. */
	function online() {
		if (!tries || tries >= TRIES) return;
		clearTimeout(retryTimer);
		retry();
	}

	// Something else on: what was said of the last one goes. By the station's id: connecting it
	// again (resume) is a new object of the same one, and must not start its tries over.
	const radioId = $derived(radio?.uuid);
	$effect(() => {
		void current;
		void radioId;
		void podcast?.id;
		void listening?.id;
		clearTimeout(retryTimer);
		clearTimeout(handoffTimer);
		handoffTimer = undefined;
		tries = 0;
		problem = null;
	});

	$effect(() => {
		music.attach(audio ?? null);
		return () => music.attach(null);
	});

	// With the screen off, what both do goes to the Registro: music that stops between songs, and
	// whether the next one had loaded.
	$effect(() => {
		const stops = players.map((el) => watchMedia(el, 'música'));
		return () => stops.forEach((stop) => stop());
	});

	// Paused by the phone alone with the screen off: played again at once, while the page is still
	// awake; a couple of times in a row at most (auto-resume.ts).
	$effect(() => {
		const el = audio;
		if (!el) return;
		let inARow = 0;
		let lastAt = 0;
		const paused = () => {
			const now = Date.now();
			if (now - lastAt > FINE_AFTER_MS) inARow = 0;
			const seen = {
				hidden: document.hidden,
				ended: el.ended,
				loading: !el.getAttribute('src') || el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA,
				askedAt: music.askedPauseAt,
				now,
				inARow
			};
			if (!shouldResume(seen)) return;
			inARow++;
			lastAt = now;
			noteAutoResume('música', inARow);
			// Refused (and why) or not answered, to the Registro; played, as «suena».
			watchPlay(el.play(), 'música');
		};
		el.addEventListener('pause', paused);
		return () => el.removeEventListener('pause', paused);
	});

	// Modo DJ follows what plays: more songs when few are left, and the DJ when it is time.
	$effect(() => {
		if (music.current && music.dj) untrack(() => void dj.step());
	});

	/** Into a song this long, the next one loads in the other: this one's own download goes first. */
	const NEXT_AFTER_SEC = 10;
	/**
	 * Modo DJ mixed with the songs (Ajustes, each person's): the DJ's words after this song, said in
	 * their own `<audio>` over its end. The next to load, then, is the song after them.
	 */
	const mixClip = $derived.by(() => {
		if (!page.data.djMix || !music.dj || radio || podcast || listening || music.single) return null;
		const clip = music.queue[music.index + 1];
		const after = music.queue[music.index + 2];
		return clip?.clip && after && !after.clip ? clip : null;
	});
	/** What plays after this one, if a song does: none with a station, an episode or «solo esta». */
	const upcoming = $derived(
		radio || podcast || listening || music.single
			? null
			: mixClip
				? music.queue[music.index + 2]!
				: (music.queue[music.index + 1] ?? (music.repeat ? music.queue[0] : null) ?? null)
	);
	const intoTheSong = $derived(music.playing && music.positionSec > NEXT_AFTER_SEC);
	const opus = () => untrack(() => musicQuality.value === 'saver');

	/** This close to the end, the moment for the next one is set (timeupdate comes every ~250 ms). */
	const HANDOFF_SEC = 2;
	/** Both sound together this long: the page is never silent, and it is hardly heard. */
	const OVERLAP_MS = 150;
	let handoffTimer: ReturnType<typeof setTimeout> | undefined;
	/** The next one already sounds in the other: the one ending is not paused, it ends by itself. */
	let handingOff = false;

	/** This long before the end of a song, the DJ starts speaking over it (Modo DJ mixed). */
	const MIX_LEAD_SEC = 6;
	/** The song going down under the DJ's voice, and back up. */
	const MIX_FADE_MS = 800;
	let voice = $state<HTMLAudioElement>();
	/** The DJ speaking over the songs: after which, and before which. */
	let speaking: { before: MusicTrack; after: MusicTrack } | null = null;

	// The DJ's words, loading while the song plays, as the next song in the other `<audio>`.
	$effect(() => {
		const el = voice;
		const clip = mixClip;
		const time = intoTheSong;
		if (!el || !clip || !time || speaking) return;
		const src = audioUrl(clip);
		if (el.getAttribute('src') !== src) el.src = src;
	});

	// As loud as the music, at the volume chosen.
	$effect(() => {
		if (voice) voice.volume = music.muted ? 0 : music.volume;
	});

	// Something else on («siguiente», another album, ✕): the DJ stops talking.
	$effect(() => {
		const now = current;
		if (speaking && now !== speaking.before && now !== speaking.after) {
			voice?.pause();
			quiet(0);
		}
	});

	/** Near the end of a song with the DJ's words after it, loaded: they start over it, lower. */
	function mixIn(el: HTMLAudioElement) {
		const clip = mixClip;
		const v = voice;
		if (!clip || !v || speaking || el.paused || !Number.isFinite(el.duration)) return;
		if (el.duration - el.currentTime > MIX_LEAD_SEC) return;
		if (v.getAttribute('src') !== audioUrl(clip)) return;
		if (v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
		speaking = { before: music.current!, after: music.queue[music.index + 2]! };
		v.currentTime = 0;
		music.duck(true, 'dj', MIX_FADE_MS);
		watchPlay(v.play(), 'música');
	}

	/** The DJ is done: the song back up. */
	function quiet(fadeMs = MIX_FADE_MS) {
		speaking = null;
		music.duck(false, 'dj', fadeMs);
	}

	/**
	 * At the end of a song, the next. Mixed, the one after the DJ's words: they already sound over
	 * it, or they were not ready in time and are left out, never a silence waiting for them.
	 */
	function afterSong() {
		if (mixClip) music.jumpTo(music.index + 2);
		else music.ended();
	}

	/** Near the end of a song, with the next one in the other `<audio>`: when it starts. */
	function planHandoff(el: HTMLAudioElement) {
		mixIn(el);
		if (handoffTimer || !upcoming || !spare || el.paused || !Number.isFinite(el.duration)) return;
		const left = (el.duration - el.currentTime) / el.playbackRate;
		if (left > HANDOFF_SEC) return;
		const next = spare;
		if (next.getAttribute('src') !== audioUrl(upcoming, opus()) || next.error) return;
		const ending = music.current;
		handoffTimer = setTimeout(
			() => {
				handoffTimer = undefined;
				// Paused, moved or another song meanwhile: as it was, at its end.
				if (el !== audio || el.paused || music.current !== ending || spare !== next) return;
				if (!upcoming || next.getAttribute('src') !== audioUrl(upcoming, opus())) return;
				if (el.duration - el.currentTime > HANDOFF_SEC) return;
				noteHandoff('música', next);
				handingOff = true;
				next.currentTime = 0;
				next.volume = el.volume;
				watchPlay(next.play(), 'música');
				afterSong();
			},
			Math.max(0, left * 1000 - OVERLAP_MS)
		);
	}

	// A new track or episode: load it and play it. Changing `src` pauses, so play() goes after.
	// Already loaded in the other `<audio>` (the next one, at the end of this one or with
	// «siguiente»), that one takes over. Brought back from the server, it waits where it was
	// (before loading, currentTime is where it starts); an episode starts where the user left it,
	// from the podcast's own server. The quality chosen in Ajustes, from the next track: not
	// starting this one again.
	$effect(() => {
		if (!audio || radio || listening) return;
		const src = podcast ? podcast.audioUrl : current ? audioUrl(current, opus()) : null;
		if (!src) {
			audio.removeAttribute('src');
			audio.load();
			return;
		}
		if (audio.getAttribute('src') === src) return;
		const restored = untrack(() => music.restored);
		const next = untrack(() => spare);
		if (!podcast && !restored && next?.getAttribute('src') === src && !next.error) {
			const ending = audio;
			untrack(() => {
				active = 1 - active;
				music.positionSec = 0;
			});
			next.volume = ending.volume;
			if (handingOff) handingOff = false;
			else {
				music.askedPauseAt = Date.now();
				ending.pause();
				next.currentTime = 0;
				watchPlay(next.play(), 'música');
			}
			return;
		}
		// Started in the other for a song that is not the one now: silenced.
		if (handingOff) next?.pause();
		handingOff = false;
		audio.src = src;
		const startAt = restored?.positionSec ?? untrack(() => podcast?.positionSec) ?? 0;
		if (startAt) audio.currentTime = startAt;
		if (!restored) watchPlay(audio.play(), 'música');
	});

	// The next song, loading in the other `<audio>` (`preload="auto"`) while this one plays: with
	// the phone asleep, the network is there while something sounds. Not while it still sounds the
	// end of the last one. After the effect above, so that a song loaded there is taken first.
	$effect(() => {
		const el = spare;
		// Both read first: the effect runs again when they change, also after a turn skipped here.
		const next = upcoming;
		const time = intoTheSong;
		if (!el || !el.paused) return;
		if (!next) {
			if (el.getAttribute('src')) {
				el.removeAttribute('src');
				el.load();
			}
			return;
		}
		if (!time) return;
		const src = audioUrl(next, opus());
		if (el.getAttribute('src') !== src) el.src = src;
	});

	// A station: its stream as is (MP3, AAC), or through hls.js where the browser has no HLS of its
	// own (all but Safari). Their servers allow it (CORS). Brought back from the server, it connects
	// when it is played.
	$effect(() => {
		const el = audio;
		const stream = radio;
		if (!el || !stream || untrack(() => music.restored)) return;
		let cancelled = false;
		(async () => {
			if (stream.hls && !el.canPlayType('application/vnd.apple.mpegurl')) {
				const { default: Hls } = await import('hls.js');
				if (cancelled || !Hls.isSupported()) return;
				hls = new Hls();
				hls.on(Hls.Events.MANIFEST_PARSED, () => watchPlay(el.play(), 'música'));
				recoverFromErrors(hls, Hls, (text) => (problem = text));
				hls.loadSource(stream.url);
				hls.attachMedia(el);
			} else {
				el.src = stream.url;
				watchPlay(el.play(), 'música');
			}
		})();
		return () => {
			cancelled = true;
			hls?.destroy();
			hls = null;
			el.removeAttribute('src');
			el.load();
		};
	});

	/** Listened episode's `<audio>` is its own: its position is kept, not another's (timeUpdate). */
	let listeningLoaded: object | null = null;
	/**
	 * Seconds of an episode only listened to (#154) loaded ahead: with the screen off, the phone
	 * cuts the network for a moment now and then (seen every ~2.5 minutes), and 30 s, hls.js's own,
	 * may not be enough.
	 */
	const LISTENING_BUFFER_SEC = 180;

	// An episode only listened to: its own HLS audio track, through hls.js where the browser has no
	// HLS of its own (as the stations), from where it goes.
	$effect(() => {
		const el = audio;
		const episode = listening;
		if (!el || !episode) return;
		let cancelled = false;
		const start = untrack(() => episode.positionSec);
		// What was on stops now, not once hls.js has loaded; and while the episode loads, the
		// `<audio>` says 0 s: its position is taken only once it plays.
		music.askedPauseAt = Date.now();
		el.pause();
		const playing = () => (listeningLoaded = episode);
		el.addEventListener('playing', playing, { once: true });
		(async () => {
			if (!el.canPlayType('application/vnd.apple.mpegurl')) {
				const { default: Hls } = await import('hls.js');
				if (cancelled || !Hls.isSupported()) return;
				hls = new Hls({
					startPosition: start,
					maxBufferLength: LISTENING_BUFFER_SEC,
					maxMaxBufferLength: LISTENING_BUFFER_SEC * 2
				});
				hls.on(Hls.Events.MANIFEST_PARSED, () => watchPlay(el.play(), 'música'));
				recoverFromErrors(hls, Hls, (text) => (problem = text));
				hls.loadSource(episode.audioUrl);
				hls.attachMedia(el);
			} else {
				el.src = episode.audioUrl;
				el.currentTime = start;
				watchPlay(el.play(), 'música');
			}
		})();
		return () => {
			cancelled = true;
			el.removeEventListener('playing', playing);
			listeningLoaded = null;
			hls?.destroy();
			hls = null;
			el.removeAttribute('src');
			el.load();
		};
	});

	// The phone's lock screen, notifications and headphone buttons:
	// https://developer.mozilla.org/docs/Web/API/Media_Session_API
	$effect(() => {
		if (!('mediaSession' in navigator)) return;
		const session = navigator.mediaSession;
		const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
			['play', () => music.resume()],
			['pause', () => music.pause()],
			// Headphones' buttons: in an episode, back and forward a little.
			[
				'previoustrack',
				() => (music.podcast || music.listening ? music.skip(-SKIP_BACK) : music.previous())
			],
			[
				'nexttrack',
				() => (music.podcast || music.listening ? music.skip(SKIP_FORWARD) : music.next())
			],
			['seekto', (d) => d.seekTime !== undefined && music.seek(d.seekTime)],
			['seekbackward', (d) => music.seek(Math.max(0, music.positionSec - (d.seekOffset ?? 10)))],
			['seekforward', (d) => music.seek(music.positionSec + (d.seekOffset ?? 10))],
			['stop', () => music.stop()]
		];
		for (const [action, handler] of handlers) {
			try {
				// Noted with the screen off, to know who stops it (media-diagnostics.ts).
				session.setActionHandler(action, (details) => {
					noteSystemAction(action, 'música');
					handler(details);
				});
			} catch {
				// Not every browser supports every action.
			}
		}
		return () => {
			for (const [action] of handlers) {
				try {
					session.setActionHandler(action, null);
				} catch {
					// Same.
				}
			}
		};
	});

	$effect(() => {
		if (!('mediaSession' in navigator)) return;
		navigator.mediaSession.metadata = radio
			? new MediaMetadata({
					title: radio.name,
					artist: `Radio · ${COUNTRIES[radio.country] ?? radio.country}`,
					artwork: radio.favicon ? [{ src: radio.favicon }] : []
				})
			: podcast
				? new MediaMetadata({
						title: podcast.title,
						artist: podcast.podcastTitle,
						artwork: podcast.imageUrl ? [{ src: podcast.imageUrl }] : []
					})
				: listening
					? new MediaMetadata({
							title: listening.title,
							artist: listening.subtitle,
							artwork: [{ src: listening.imageUrl }]
						})
					: current
						? new MediaMetadata({
								title: current.title,
								artist: current.artist,
								album: current.album,
								artwork: current.hasCover
									? [{ src: coverUrl(current.albumId), sizes: '500x500', type: 'image/jpeg' }]
									: []
							})
						: null;
	});

	$effect(() => {
		if ('mediaSession' in navigator)
			navigator.mediaSession.playbackState =
				!current && !podcast && !listening ? 'none' : music.playing ? 'playing' : 'paused';
	});

	function timeUpdate() {
		if (!audio) return;
		planHandoff(audio);
		music.positionSec = audio.currentTime;
		// The episode's own position, only while its own audio is loaded (see podcast-player).
		if (podcast && audio.getAttribute('src') === podcast.audioUrl)
			podcast.positionSec = audio.currentTime;
		if (listening && listeningLoaded === listening) listening.positionSec = audio.currentTime;
		const duration = Number.isFinite(audio.duration) ? audio.duration : null;
		music.durationSec = duration;
		if (duration && 'mediaSession' in navigator) {
			try {
				navigator.mediaSession.setPositionState({
					duration,
					position: Math.min(audio.currentTime, duration),
					playbackRate: audio.playbackRate
				});
			} catch {
				// Older browsers.
			}
		}
	}

	// Rectangular with rounded corners, all the size of «play», like the app's other buttons.
	const base =
		'flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40';
	const control = `${base} bg-zinc-800 text-zinc-200 hover:bg-zinc-700`;
	const primary = `${base} bg-amber-500 text-zinc-950 hover:bg-amber-400`;
	const ghost = `${base} text-zinc-400 hover:bg-zinc-800 hover:text-white`;
</script>

<svelte:window ononline={online} />

<!-- The volume, only with a mouse (a PC): phones and tablets have their own buttons, and an iPhone
does not let a page change it. -->
{#snippet volume(order = '')}
	<span class="hidden shrink-0 items-center gap-1 pointer-fine:flex {order}">
		<button
			class={ghost}
			aria-label={music.muted ? 'Activar el sonido' : 'Silenciar'}
			title={music.muted ? 'Activar el sonido' : 'Silenciar'}
			onclick={() => music.toggleMute()}
			><MediaIcon name={music.muted ? 'muted' : 'volume'} /></button
		>
		<input
			type="range"
			min="0"
			max="1"
			step="0.05"
			value={music.muted ? 0 : music.volume}
			aria-label="Volumen"
			class="h-1 w-20 accent-amber-500"
			oninput={(e) => music.setVolume(Number(e.currentTarget.value))}
		/>
	</span>
{/snippet}

<!-- Only the one that sounds tells the bar; the other is the next song, loading (#180). -->
{#each [0, 1] as i (i)}
	{@const on = (e: Event) => e.currentTarget === audio}
	<audio
		bind:this={players[i]}
		preload="auto"
		onplay={(e) => {
			if (!on(e)) return;
			music.playing = true;
			music.restored = null;
			if (speaking && voice?.paused && !voice.ended) watchPlay(voice.play(), 'música');
		}}
		onplaying={(e) => {
			if (!on(e)) return;
			tries = 0;
			problem = null;
		}}
		onerror={(e) => on(e) && failed()}
		onpause={(e) => {
			if (!on(e)) return;
			music.playing = false;
			// Paused by hand while the DJ speaks over it: the DJ too.
			if (speaking && !e.currentTarget.ended) voice?.pause();
		}}
		ontimeupdate={(e) => on(e) && timeUpdate()}
		ondurationchange={(e) => on(e) && timeUpdate()}
		loop={i === active && music.single && music.repeat}
		onended={(e) => {
			if (!on(e)) return;
			if (radio) failed();
			else if (podcast) podcastEnded();
			else if (listening) listeningEnded();
			else afterSong();
		}}
	></audio>
{/each}
<!-- Modo DJ mixed: the DJ's words over the songs, apart from the two that take turns. -->
<audio bind:this={voice} preload="auto" onended={() => quiet()} onerror={() => speaking && quiet()}
></audio>

<!-- A podcast episode or a library episode only listened to (#154): the same bar, with ±seconds
and the speed. -->
{#snippet talkBar(talk: {
	title: string;
	subtitle: string;
	imageUrl: string | null;
	href: string;
	icon: string;
	durationSec: number | null;
})}
	<div class="rounded-md border border-zinc-700 bg-zinc-900/80 p-2 backdrop-blur">
		<input
			type="range"
			min="0"
			max={music.durationSec ?? talk.durationSec ?? 0}
			step="1"
			value={music.positionSec}
			aria-label="Posición"
			class="mb-1 block h-1 w-full accent-amber-500"
			onchange={(e) => music.seek(Number(e.currentTarget.value))}
		/>
		<!-- Two rows on the phone, as with music: the episode, then the time and the controls. -->
		<div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 sm:flex-nowrap sm:gap-3">
			<a href={talk.href} class="order-1 flex min-w-0 flex-1 items-center gap-3">
				{#if talk.imageUrl}
					<img
						src={talk.imageUrl}
						alt=""
						class="h-10 w-10 shrink-0 rounded bg-zinc-800 object-cover"
					/>
				{:else}
					<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-zinc-800"
						>{talk.icon}</span
					>
				{/if}
				<span class="min-w-0">
					<span class="block truncate text-sm">{talk.title}</span>
					{#if problem}
						<span class="block truncate text-xs text-amber-400">{problem}</span>
					{:else}
						<span class="block truncate text-xs text-zinc-400"
							>{music.restored
								? `Sonaba en ${music.restored.changedBy} · ${talk.subtitle}`
								: talk.subtitle}</span
						>
					{/if}
				</span>
			</a>
			{@render volume('order-7')}
			<button
				class="{ghost} order-2 sm:order-9"
				aria-label="Cerrar"
				title="Parar y cerrar"
				onclick={() => music.stop()}><MediaIcon name="close" /></button
			>
			<span class="order-3 basis-full sm:hidden" aria-hidden="true"></span>
			<span class="order-4 font-mono text-[11px] text-zinc-400 tabular-nums sm:text-xs">
				{formatDuration(music.positionSec) || '0:00'} / {formatDuration(
					music.durationSec ?? talk.durationSec
				)}
			</span>
			<span class="order-6 ml-auto flex items-center gap-1.5 sm:ml-0 sm:gap-2">
				<button
					class="{ghost} w-auto! px-2 font-mono text-xs tabular-nums max-sm:h-8"
					title="Velocidad"
					aria-label="Velocidad: {speedLabel(music.speed)}"
					onclick={nextSpeed}>{speedLabel(music.speed)}</button
				>
				<button
					class="{control} w-auto! px-2 text-xs max-sm:h-8"
					aria-label="Atrás {SKIP_BACK} segundos"
					onclick={() => music.skip(-SKIP_BACK)}>−{SKIP_BACK}</button
				>
				<button
					class={primary}
					aria-label={music.playing ? 'Pausa' : 'Seguir'}
					onclick={() => music.toggle()}
					><MediaIcon name={music.playing ? 'pause' : 'play'} /></button
				>
				<button
					class="{control} w-auto! px-2 text-xs max-sm:h-8"
					aria-label="Adelante {SKIP_FORWARD} segundos"
					onclick={() => music.skip(SKIP_FORWARD)}>+{SKIP_FORWARD}</button
				>
			</span>
		</div>
	</div>
{/snippet}

{#if radio}
	<div
		class="flex items-center gap-3 rounded-md border border-zinc-700 bg-zinc-900/80 p-2 backdrop-blur"
	>
		<a href="/radio" class="flex min-w-0 flex-1 items-center gap-3">
			{#if radio.favicon}
				<img
					src={radio.favicon}
					alt=""
					class="h-10 w-10 shrink-0 rounded bg-white object-contain p-0.5"
					onerror={(e) => e.currentTarget.classList.add('hidden')}
				/>
			{/if}
			<span class="min-w-0">
				<span class="block truncate text-sm">{radio.name}</span>
				<span class="block truncate text-xs text-zinc-400">
					{#if problem}
						<span class="text-amber-400">{problem}</span>
					{:else if music.restored}
						Sonaba en {music.restored.changedBy}
					{:else}
						<span class="text-red-400">●</span> En directo
					{/if}
					· {COUNTRIES[radio.country] ?? radio.country}
				</span>
			</span>
		</a>
		<button
			class={primary}
			aria-label={music.playing ? 'Pausa' : 'Seguir'}
			onclick={() => music.toggle()}><MediaIcon name={music.playing ? 'pause' : 'play'} /></button
		>
		{@render volume()}
		<button class={ghost} aria-label="Cerrar" title="Parar y cerrar" onclick={() => music.stop()}
			><MediaIcon name="close" /></button
		>
	</div>
{:else if podcast}
	{@render talkBar({
		title: podcast.title,
		subtitle: podcast.podcastTitle,
		imageUrl: podcast.imageUrl,
		href: `/radio/podcasts/${podcast.podcastId}`,
		icon: '🎙',
		durationSec: podcast.durationSec
	})}
{:else if listening}
	{@render talkBar({
		title: listening.title,
		subtitle: `🎧 ${listening.subtitle}`,
		imageUrl: listening.imageUrl,
		href: `/watch/${listening.id}`,
		icon: '🎧',
		durationSec: listening.durationSec
	})}
{:else if current}
	{#snippet modes()}
		<PlayModes
			shuffle={music.shuffle}
			repeat={music.repeat}
			single={music.single}
			onchange={(mode, value) => {
				if (mode === 'shuffle') music.setShuffle(value);
				else music[mode] = value;
			}}
		/>
	{/snippet}
	<div class="rounded-md border border-zinc-700 bg-zinc-900/80 p-2 backdrop-blur">
		<input
			type="range"
			min="0"
			max={music.durationSec ?? current.durationSec ?? 0}
			step="1"
			value={music.positionSec}
			aria-label="Posición"
			class="mb-1 block h-1 w-full accent-amber-500"
			onchange={(e) => music.seek(Number(e.currentTarget.value))}
		/>
		<!-- On the phone, two rows: what sounds, with all the width it can get (the title was barely
		     readable next to five buttons), then the time and the controls. One row from sm. -->
		<div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 sm:flex-nowrap sm:gap-3">
			<!-- The DJ's words, and what is not the library's (a prayer), have no album to go to. -->
			<svelte:element
				this={current.clip || current.src ? 'div' : 'a'}
				href={current.clip || current.src ? undefined : `/musica/${current.albumId}`}
				class="order-1 flex min-w-0 flex-1 items-center gap-3"
			>
				{#if current.hasCover}
					<img
						src={coverUrl(current.albumId)}
						alt=""
						class="h-10 w-10 shrink-0 rounded bg-zinc-800 object-cover"
					/>
				{:else}
					<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-zinc-800"
						>{current.clip ? '🎙' : '♪'}</span
					>
				{/if}
				<span class="min-w-0">
					<span class="block truncate text-sm">{current.title}</span>
					{#if problem}
						<span class="block truncate text-xs text-amber-400">{problem}</span>
					{:else}
						<span class="block truncate text-xs text-zinc-400"
							>{music.restored
								? `Sonaba en ${music.restored.changedBy} · ${current.artist}`
								: `${current.artist} · ${current.album}`}</span
						>
					{/if}
				</span>
			</svelte:element>
			{#if music.dj}
				<!-- Modo DJ: what is queued goes on without the DJ when it is left. -->
				<button
					class="order-2 shrink-0 rounded-full border border-amber-500/60 px-2 py-0.5 text-xs text-amber-400 hover:bg-zinc-800 sm:order-7"
					title="Salir del modo DJ: sigue lo que hay en la cola, sin locutor"
					onclick={() => dj.stop()}>DJ ✕</button
				>
			{/if}
			{#if music.stopAfterId !== null || music.stopAt}
				<!-- Asked by voice: «para cuando acabe esta», «apágala en media hora». -->
				<button
					class="order-2 shrink-0 rounded-full border border-sky-500/60 px-2 py-0.5 text-xs text-sky-300 hover:bg-zinc-800 sm:order-7"
					title="Se parará sola. Tócalo para que no"
					onclick={() => music.cancelStop()}
					>⏹ {music.stopAfterId !== null ? 'al acabar esta' : stopTime(music.stopAt!)} ✕</button
				>
			{/if}
			{@render volume('order-7')}
			<button
				class={[ghost, 'order-2 sm:order-8', showQueue && 'bg-zinc-800 text-white']}
				aria-label="Cola"
				aria-expanded={showQueue}
				title="Cola: lo que suena y lo que viene"
				onclick={() => (showQueue = !showQueue)}><MediaIcon name="queue" /></button
			>
			<button
				class="{ghost} order-2 sm:order-9"
				aria-label="Cerrar"
				title="Parar y cerrar"
				onclick={() => music.stop()}><MediaIcon name="close" /></button
			>
			<span class="order-3 basis-full sm:hidden" aria-hidden="true"></span>
			<span class="order-4 font-mono text-[11px] text-zinc-400 tabular-nums sm:text-xs">
				{formatDuration(music.positionSec) || '0:00'} / {formatDuration(
					music.durationSec ?? current.durationSec
				)}
			</span>
			<!-- A bit smaller on the phone, so the time and every control fit in one row at 360px. -->
			<span class="order-5 flex gap-1 max-sm:[&>button]:h-8 max-sm:[&>button]:w-8"
				>{@render modes()}</span
			>
			<span class="order-6 ml-auto flex items-center gap-1.5 sm:ml-0 sm:gap-2">
				<button
					class="{control} max-sm:h-8 max-sm:w-8"
					aria-label="Anterior"
					onclick={() => music.previous()}><MediaIcon name="previous" /></button
				>
				<button
					class={primary}
					aria-label={music.playing ? 'Pausa' : 'Seguir'}
					onclick={() => music.toggle()}
					><MediaIcon name={music.playing ? 'pause' : 'play'} /></button
				>
				<button
					class="{control} max-sm:h-8 max-sm:w-8"
					aria-label="Siguiente"
					disabled={music.index >= music.queue.length - 1 && !music.repeat}
					onclick={() => music.next()}><MediaIcon name="next" /></button
				>
			</span>
		</div>
		{#if showQueue}
			<!-- «+ Añadir a la cola» of an album adds at the end. What played stays, dimmed: it is
			     still the queue, and «anterior» or repeat go back to it. -->
			<ol
				bind:this={queueList}
				class="mt-2 max-h-[50vh] overflow-y-auto border-t border-zinc-800 pt-1"
				aria-label="Cola"
			>
				{#each music.queue as t, i (`${i}:${t.id}`)}
					<li class="flex items-center">
						<button
							class={[
								'flex min-w-0 flex-1 items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-zinc-800',
								i === music.index ? 'text-amber-400' : i < music.index && 'text-zinc-500'
							]}
							aria-current={i === music.index ? 'true' : undefined}
							onclick={() => music.jumpTo(i)}
						>
							<span class="w-6 shrink-0 text-right font-mono text-xs tabular-nums"
								>{i === music.index ? '♪' : i + 1}</span
							>
							<span class="min-w-0 flex-1 truncate text-sm"
								>{t.title} <span class="text-zinc-500">· {t.artist}</span></span
							>
							<span class="font-mono text-xs text-zinc-500 tabular-nums"
								>{formatDuration(t.durationSec)}</span
							>
						</button>
						{#if i !== music.index}
							<button
								class="{ghost} h-7! w-7!"
								aria-label="Quitar {t.title} de la cola"
								title="Quitar de la cola"
								onclick={() => music.remove(i)}><MediaIcon name="close" class="h-3 w-3" /></button
							>
						{:else}
							<span class="w-7 shrink-0" aria-hidden="true"></span>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</div>
{/if}

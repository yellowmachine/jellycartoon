<script lang="ts">
	import MediaIcon from './MediaIcon.svelte';
	import PlayModes from './PlayModes.svelte';
	import { untrack } from 'svelte';
	import type Hls from 'hls.js';
	import { formatDuration } from '#lib/format.ts';
	import { GAVE_UP, RETRYING, TRIES, recoverFromErrors, retryDelay } from '#lib/hls-recovery.ts';
	import { dj } from '#lib/dj.svelte.ts';
	import { audioUrl, coverUrl } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import { musicQuality } from '#lib/music-quality.svelte.ts';
	import { keepQueue } from '#lib/music-queue.svelte.ts';
	import { keepPodcastProgress, podcastEnded } from '#lib/podcast-player.svelte.ts';
	import { SKIP_BACK, SKIP_FORWARD, SPEEDS, type Speed } from '#lib/podcasts.ts';
	import { COUNTRIES } from '#lib/radio.ts';
	import { watchMedia, watchPlay } from '#lib/media-diagnostics.ts';
	import { nextTrack } from '#lib/next-track.ts';

	let audio = $state<HTMLAudioElement>();
	const current = $derived(music.current);
	const radio = $derived(music.radio);
	const podcast = $derived(music.podcast);
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
		const rate = podcast ? music.speed : 1;
		audio.defaultPlaybackRate = rate;
		audio.playbackRate = rate;
	});

	/**
	 * The `<audio>` failed with its own `src` (hls.js handles its own): it is tried again, a few
	 * times and each a little later. A station connects again; a track or an episode is loaded
	 * again from where it was, e.g. the next track asked for with the phone asleep. Brought back
	 * from the server and not played yet, it only says so: play loads it again.
	 */
	function failed() {
		if (hls || !audio?.getAttribute('src')) return;
		clearTimeout(retryTimer);
		const gaveUp = radio
			? GAVE_UP
			: podcast
				? 'No se pudo reproducir este episodio.'
				: 'No se pudo reproducir esta canción.';
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
		clearTimeout(retryTimer);
		tries = 0;
		problem = null;
	});

	$effect(() => {
		music.attach(audio ?? null);
		return () => music.attach(null);
	});

	// With the screen off, what it does goes to the Registro: music that stops between songs.
	$effect(() => {
		if (audio) return watchMedia(audio, 'música');
	});

	// Modo DJ follows what plays: more songs when few are left, and the DJ when it is time.
	$effect(() => {
		if (music.current && music.dj) untrack(() => void dj.step());
	});

	/** The track in the `<audio>`: its address, and what it was loaded from (its copy, maybe). */
	let loaded: { src: string; from: string; copy: boolean } | null = null;

	/** The copy in memory of the track that was on, once another is loaded. */
	function dropCopy() {
		if (loaded?.copy) URL.revokeObjectURL(loaded.from);
		loaded = null;
	}

	/** Into a song this long, the next one is downloaded: this one's own download goes first. */
	const NEXT_AFTER_SEC = 10;
	/** What plays after this one, if a song does: none with a station, an episode or «solo esta». */
	const upcoming = $derived(
		radio || podcast || music.single
			? null
			: (music.queue[music.index + 1] ?? (music.repeat ? music.queue[0] : null) ?? null)
	);
	const intoTheSong = $derived(music.playing && music.positionSec > NEXT_AFTER_SEC);
	// The next song, in memory while this one plays (next-track.ts): with the phone asleep, the
	// network is there while something sounds, and not in the silence between two songs.
	$effect(() => {
		if (!upcoming) return void nextTrack.forget();
		if (!intoTheSong) return;
		nextTrack.want(
			audioUrl(
				upcoming,
				untrack(() => musicQuality.value === 'saver')
			)
		);
	});

	// A new track or episode: load it and play it. Changing `src` pauses, so play() goes after.
	// Brought back from the server, it waits where it was (before loading, currentTime is where it
	// starts); an episode starts where the user left it, from the podcast's own server. The quality
	// chosen in Ajustes, from the next track: not starting this one again.
	$effect(() => {
		if (!audio || radio) return;
		const opus = untrack(() => musicQuality.value === 'saver');
		const src = podcast ? podcast.audioUrl : current ? audioUrl(current, opus) : null;
		if (!src) {
			audio.removeAttribute('src');
			audio.load();
			dropCopy();
			return;
		}
		// Loaded already: the same track, from the server or from its copy in memory.
		if (loaded?.src !== src || audio.getAttribute('src') !== loaded.from) {
			const copy = nextTrack.take(src);
			audio.src = copy ?? src;
			dropCopy();
			loaded = { src, from: copy ?? src, copy: Boolean(copy) };
			const restored = untrack(() => music.restored);
			const startAt = restored?.positionSec ?? untrack(() => podcast?.positionSec) ?? 0;
			if (startAt) audio.currentTime = startAt;
			if (!restored) watchPlay(audio.play(), 'música');
		}
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

	// The phone's lock screen, notifications and headphone buttons:
	// https://developer.mozilla.org/docs/Web/API/Media_Session_API
	$effect(() => {
		if (!('mediaSession' in navigator)) return;
		const session = navigator.mediaSession;
		const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
			['play', () => music.resume()],
			['pause', () => music.pause()],
			// Headphones' buttons: in an episode, back and forward a little.
			['previoustrack', () => (music.podcast ? music.skip(-SKIP_BACK) : music.previous())],
			['nexttrack', () => (music.podcast ? music.skip(SKIP_FORWARD) : music.next())],
			['seekto', (d) => d.seekTime !== undefined && music.seek(d.seekTime)],
			['seekbackward', (d) => music.seek(Math.max(0, music.positionSec - (d.seekOffset ?? 10)))],
			['seekforward', (d) => music.seek(music.positionSec + (d.seekOffset ?? 10))],
			['stop', () => music.stop()]
		];
		for (const [action, handler] of handlers) {
			try {
				session.setActionHandler(action, handler);
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
				!current && !podcast ? 'none' : music.playing ? 'playing' : 'paused';
	});

	function timeUpdate() {
		if (!audio) return;
		music.positionSec = audio.currentTime;
		// The episode's own position, only while its own audio is loaded (see podcast-player).
		if (podcast && audio.getAttribute('src') === podcast.audioUrl)
			podcast.positionSec = audio.currentTime;
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

<audio
	bind:this={audio}
	preload="auto"
	onplay={() => {
		music.playing = true;
		music.restored = null;
	}}
	onplaying={() => {
		tries = 0;
		problem = null;
	}}
	onerror={failed}
	onpause={() => (music.playing = false)}
	ontimeupdate={timeUpdate}
	ondurationchange={timeUpdate}
	loop={music.single && music.repeat}
	onended={() => (radio ? failed() : podcast ? podcastEnded() : music.ended())}
></audio>

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
		<button class={ghost} aria-label="Cerrar" title="Parar y cerrar" onclick={() => music.stop()}
			><MediaIcon name="close" /></button
		>
	</div>
{:else if podcast}
	<div class="rounded-md border border-zinc-700 bg-zinc-900/80 p-2 backdrop-blur">
		<input
			type="range"
			min="0"
			max={music.durationSec ?? podcast.durationSec ?? 0}
			step="1"
			value={music.positionSec}
			aria-label="Posición"
			class="mb-1 block h-1 w-full accent-amber-500"
			onchange={(e) => music.seek(Number(e.currentTarget.value))}
		/>
		<!-- Two rows on the phone, as with music: the episode, then the time and the controls. -->
		<div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 sm:flex-nowrap sm:gap-3">
			<a
				href="/radio/podcasts/{podcast.podcastId}"
				class="order-1 flex min-w-0 flex-1 items-center gap-3"
			>
				{#if podcast.imageUrl}
					<img
						src={podcast.imageUrl}
						alt=""
						class="h-10 w-10 shrink-0 rounded bg-zinc-800 object-cover"
					/>
				{:else}
					<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-zinc-800"
						>🎙</span
					>
				{/if}
				<span class="min-w-0">
					<span class="block truncate text-sm">{podcast.title}</span>
					{#if problem}
						<span class="block truncate text-xs text-amber-400">{problem}</span>
					{:else}
						<span class="block truncate text-xs text-zinc-400"
							>{music.restored
								? `Sonaba en ${music.restored.changedBy} · ${podcast.podcastTitle}`
								: podcast.podcastTitle}</span
						>
					{/if}
				</span>
			</a>
			<button
				class="{ghost} order-2 sm:order-9"
				aria-label="Cerrar"
				title="Parar y cerrar"
				onclick={() => music.stop()}><MediaIcon name="close" /></button
			>
			<span class="order-3 basis-full sm:hidden" aria-hidden="true"></span>
			<span class="order-4 font-mono text-[11px] text-zinc-400 tabular-nums sm:text-xs">
				{formatDuration(music.positionSec) || '0:00'} / {formatDuration(
					music.durationSec ?? podcast.durationSec
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
			<!-- The DJ's words have no album to go to. -->
			<svelte:element
				this={current.clip ? 'div' : 'a'}
				href={current.clip ? undefined : `/musica/${current.albumId}`}
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

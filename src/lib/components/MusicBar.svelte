<script lang="ts">
	import MediaIcon from './MediaIcon.svelte';
	import PlayModes from './PlayModes.svelte';
	import { untrack } from 'svelte';
	import type Hls from 'hls.js';
	import { formatDuration } from '#lib/format.ts';
	import { GAVE_UP, RETRYING, TRIES, recoverFromErrors, retryDelay } from '#lib/hls-recovery.ts';
	import { coverUrl, trackUrl } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import { keepQueue } from '#lib/music-queue.svelte.ts';
	import { COUNTRIES } from '#lib/radio.ts';

	let audio = $state<HTMLAudioElement>();
	const current = $derived(music.current);
	const radio = $derived(music.radio);
	let hls: Hls | null = null;
	/** A station off the air or a dropped connection, said while it is tried again. */
	let problem = $state<string | null>(null);
	/** Reconnections of a station played as is (not HLS) since it last played. */
	let tries = 0;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;

	keepQueue();

	/**
	 * The `<audio>` failed with its own `src` (hls.js handles its own): a station connects again,
	 * a few times and each a little later; a track only says so.
	 */
	function failed() {
		if (hls || !audio?.getAttribute('src')) return;
		clearTimeout(retryTimer);
		if (!radio) return void (problem = 'No se pudo reproducir esta canción.');
		if (tries >= TRIES) return void (problem = GAVE_UP);
		tries++;
		problem = RETRYING;
		retryTimer = setTimeout(() => music.resume(), retryDelay(tries));
	}

	// Something else on: what was said of the last one goes. By the station's id: connecting it
	// again (resume) is a new object of the same one, and must not start its tries over.
	const radioId = $derived(radio?.uuid);
	$effect(() => {
		void current;
		void radioId;
		clearTimeout(retryTimer);
		tries = 0;
		problem = null;
	});

	$effect(() => {
		music.attach(audio ?? null);
		return () => music.attach(null);
	});

	// A new track: load it and play it. Changing `src` pauses, so play() goes after. Brought back
	// from the server, it waits where it was (before loading, currentTime is where it starts).
	$effect(() => {
		if (!audio || radio) return;
		if (!current) {
			audio.removeAttribute('src');
			audio.load();
			return;
		}
		const src = trackUrl(current.id);
		if (audio.getAttribute('src') !== src) {
			audio.src = src;
			const restored = untrack(() => music.restored);
			if (restored) audio.currentTime = restored.positionSec;
			else void audio.play().catch(() => {});
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
				hls.on(Hls.Events.MANIFEST_PARSED, () => void el.play().catch(() => {}));
				recoverFromErrors(hls, Hls, (text) => (problem = text));
				hls.loadSource(stream.url);
				hls.attachMedia(el);
			} else {
				el.src = stream.url;
				void el.play().catch(() => {});
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
			['previoustrack', () => music.previous()],
			['nexttrack', () => music.next()],
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
			navigator.mediaSession.playbackState = !current
				? 'none'
				: music.playing
					? 'playing'
					: 'paused';
	});

	function timeUpdate() {
		if (!audio) return;
		music.positionSec = audio.currentTime;
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
	onended={() => (radio ? failed() : music.ended())}
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
			<a href="/musica/{current.albumId}" class="order-1 flex min-w-0 flex-1 items-center gap-3">
				{#if current.hasCover}
					<img
						src={coverUrl(current.albumId)}
						alt=""
						class="h-10 w-10 shrink-0 rounded bg-zinc-800 object-cover"
					/>
				{:else}
					<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-zinc-800"
						>♪</span
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
	</div>
{/if}

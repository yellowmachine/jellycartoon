<script lang="ts">
	import { formatDuration } from '#lib/format.ts';
	import { coverUrl, trackUrl } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';

	let audio = $state<HTMLAudioElement>();
	const current = $derived(music.current);

	$effect(() => {
		music.attach(audio ?? null);
		return () => music.attach(null);
	});

	// A new track: load it and play it. Changing `src` pauses, so play() goes after.
	$effect(() => {
		if (!audio) return;
		if (!current) {
			audio.removeAttribute('src');
			audio.load();
			return;
		}
		const src = trackUrl(current.id);
		if (audio.getAttribute('src') !== src) {
			audio.src = src;
			void audio.play().catch(() => {});
		}
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
		navigator.mediaSession.metadata = current
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

	const control =
		'flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-zinc-800';
</script>

<audio
	bind:this={audio}
	preload="auto"
	onplay={() => (music.playing = true)}
	onpause={() => (music.playing = false)}
	ontimeupdate={timeUpdate}
	ondurationchange={timeUpdate}
	onended={() => music.next()}
></audio>

{#if current}
	<div class="rounded-t-md border border-zinc-700 bg-zinc-950/95 p-2 backdrop-blur">
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
		<div class="flex items-center gap-3">
			<a href="/musica/{current.albumId}" class="flex min-w-0 flex-1 items-center gap-3">
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
					<span class="block truncate text-xs text-zinc-400"
						>{current.artist} · {current.album}</span
					>
				</span>
			</a>
			<span class="hidden font-mono text-xs text-zinc-400 tabular-nums sm:inline">
				{formatDuration(music.positionSec) || '0:00'} / {formatDuration(
					music.durationSec ?? current.durationSec
				)}
			</span>
			<button class={control} aria-label="Anterior" onclick={() => music.previous()}>{'⏮︎'}</button>
			<button
				class="{control} bg-amber-500 text-zinc-950 hover:bg-amber-400"
				aria-label={music.playing ? 'Pausa' : 'Seguir'}
				onclick={() => music.toggle()}>{music.playing ? '❚❚' : '▶︎'}</button
			>
			<button
				class={control}
				aria-label="Siguiente"
				disabled={music.index >= music.queue.length - 1}
				onclick={() => music.next()}>{'⏭︎'}</button
			>
			<button
				class="{control} text-zinc-400 hover:text-white"
				aria-label="Cerrar"
				title="Parar y cerrar"
				onclick={() => music.stop()}>✕</button
			>
		</div>
	</div>
{/if}

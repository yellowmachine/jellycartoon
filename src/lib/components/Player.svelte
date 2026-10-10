<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import type Hls from 'hls.js';
	import '@fontsource/atkinson-hyperlegible/400.css';
	import '@fontsource/comic-neue/400.css';
	import { normalizeLang, type AudioTrack, type SubtitleTrack } from '#lib/languages.ts';
	import { subtitleCss, type SubtitleStyle } from '#lib/subtitle-style.ts';
	import SubtitleStylePanel from './SubtitleStylePanel.svelte';
	import {
		PLAYER_SIZES,
		loadPlayerSize,
		playerSize,
		setPlayerSize,
		type PlayerSize
	} from '#lib/player-size.svelte.ts';

	interface Props {
		episodeId: number;
		startAt?: number | null;
		audioTracks: AudioTrack[];
		subtitles: SubtitleTrack[];
		settings: {
			audioLang: string | null;
			subtitleLang: string | null;
			subtitleStyle: SubtitleStyle;
		};
		autoplay?: boolean;
		/** Called after the final position has been saved. */
		onended?: () => void;
	}

	let {
		episodeId,
		startAt = 0,
		audioTracks,
		subtitles,
		settings,
		autoplay = true,
		onended
	}: Props = $props();

	let video = $state<HTMLVideoElement>();
	let hls: Hls | null = null;
	let lastSaved = 0;

	const pick = <T extends { lang: string }>(tracks: T[], lang: string | null) =>
		lang ? tracks.findIndex((t) => t.lang === normalizeLang(lang)) : -1;

	// Overridden locally on change (and saved); fresh server data resets them.
	let audioLang = $derived(settings.audioLang);
	let subtitleLang = $derived(settings.subtitleLang);
	let subtitleStyle = $derived(settings.subtitleStyle);
	let showStylePanel = $state(false);

	// ::cue can't be styled inline, so the chosen style becomes a stylesheet. Values come from the
	// fixed option table in subtitle-style.ts, never from free text.
	const cueStylesheet = $derived.by(() => {
		const css = subtitleCss(subtitleStyle);
		return `<style>.jc-video::cue{font-family:${css.fontFamily};font-size:${css.fontScale}em;color:${css.color};background:${css.background};text-shadow:${css.textShadow};line-height:1.35}</style>`;
	});
	let audioIndex = $derived(Math.max(0, pick(audioTracks, audioLang)));
	let subtitleIndex = $derived(pick(subtitles, subtitleLang));

	const src = $derived(`/api/hls/${episodeId}/master.m3u8`);

	let wrapper = $state<HTMLDivElement>();

	async function chooseSize(size: PlayerSize) {
		setPlayerSize(size);
		if (size !== 'cinema' || !wrapper) return;
		// The video is as tall as the window minus the header: line it up right below it.
		await tick();
		const header = document.querySelector('header')?.offsetHeight ?? 0;
		window.scrollTo({ top: wrapper.getBoundingClientRect().top + window.scrollY - header });
	}

	let pipSupported = $state(false);
	let inPip = $state(false);

	onMount(() => {
		loadPlayerSize();
		pipSupported = 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
	});

	$effect(() => {
		const el = video;
		if (!el) return;
		const enter = () => (inPip = true);
		const leave = () => (inPip = false);
		el.addEventListener('enterpictureinpicture', enter);
		el.addEventListener('leavepictureinpicture', leave);
		return () => {
			el.removeEventListener('enterpictureinpicture', enter);
			el.removeEventListener('leavepictureinpicture', leave);
		};
	});

	async function togglePip() {
		if (!video) return;
		try {
			if (document.pictureInPictureElement) await document.exitPictureInPicture();
			else await video.requestPictureInPicture();
		} catch (error) {
			console.warn('[player] picture-in-picture', error);
		}
	}

	$effect(() => {
		const el = video;
		const url = src;
		if (!el) return;
		// Only a new episode (src) or <video> should reload the stream.
		const start = untrack(() => (startAt && startAt > 5 ? startAt : 0));
		let cancelled = false;

		(async () => {
			const { default: Hls } = await import('hls.js');
			if (cancelled) return;
			if (Hls.isSupported()) {
				const instance = new Hls({ startPosition: start || -1 });
				hls = instance;
				// The audio track list is not known yet at MANIFEST_PARSED.
				instance.once(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
					instance.audioTrack = untrack(() => audioIndex);
				});
				instance.on(Hls.Events.MANIFEST_PARSED, () => {
					if (untrack(() => autoplay)) el.play().catch(() => {});
				});
				instance.loadSource(url);
				instance.attachMedia(el);
			} else if (el.canPlayType('application/vnd.apple.mpegurl')) {
				// Safari plays HLS natively.
				el.src = url;
				el.addEventListener(
					'loadedmetadata',
					() => {
						if (start) el.currentTime = start;
						selectNativeAudio(untrack(() => audioIndex));
						if (untrack(() => autoplay)) el.play().catch(() => {});
					},
					{ once: true }
				);
			}
		})();

		return () => {
			cancelled = true;
			hls?.destroy();
			hls = null;
		};
	});

	function selectNativeAudio(index: number) {
		const tracks = (
			video as HTMLVideoElement & {
				audioTracks?: { length: number; [i: number]: { enabled: boolean } };
			}
		)?.audioTracks;
		if (!tracks) return;
		for (let i = 0; i < tracks.length; i++) tracks[i].enabled = i === index;
	}

	function saveSetting(values: {
		audioLang?: string | null;
		subtitleLang?: string | null;
		subtitleStyle?: SubtitleStyle;
	}) {
		fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(values)
		}).catch(() => {});
	}

	function chooseAudio(index: number) {
		audioLang = audioTracks[index].lang;
		if (hls) hls.audioTrack = index;
		else selectNativeAudio(index);
		saveSetting({ audioLang });
	}

	function chooseSubtitle(index: number) {
		subtitleLang = index < 0 ? null : subtitles[index].lang;
		saveSetting({ subtitleLang });
	}

	let styleSaveTimer: ReturnType<typeof setTimeout> | undefined;

	function chooseStyle(style: SubtitleStyle) {
		subtitleStyle = style;
		// Several quick clicks become one request, so an older one can't arrive last and win.
		clearTimeout(styleSaveTimer);
		styleSaveTimer = setTimeout(() => saveSetting({ subtitleStyle }), 400);
	}

	// Show the chosen subtitle track, hide the rest.
	$effect(() => {
		const tracks = video?.textTracks;
		if (!tracks) return;
		for (let i = 0; i < tracks.length; i++) {
			tracks[i].mode = i === subtitleIndex ? 'showing' : 'disabled';
		}
	});

	// Follow changes made from the browser's own captions menu.
	function onTextTrackChange() {
		const tracks = video?.textTracks;
		if (!tracks) return;
		let showing = -1;
		for (let i = 0; i < tracks.length; i++) if (tracks[i].mode === 'showing') showing = i;
		if (showing !== subtitleIndex) chooseSubtitle(showing);
	}

	$effect(() => {
		const tracks = video?.textTracks;
		tracks?.addEventListener('change', onTextTrackChange);
		return () => tracks?.removeEventListener('change', onTextTrackChange);
	});

	function save() {
		if (!video?.currentTime) return Promise.resolve();
		lastSaved = Date.now();
		// keepalive lets the request finish even if the page is being closed.
		return fetch('/api/progress', {
			method: 'POST',
			keepalive: true,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				episodeId,
				positionSec: video.currentTime,
				durationSec: video.duration
			})
		}).catch(() => {});
	}

	let thumbnailState = $state<'idle' | 'saving' | 'done' | 'failed'>('idle');

	/** The frame on screen becomes the episode's thumbnail; taken by the server from the video. */
	async function useAsThumbnail() {
		if (!video) return;
		thumbnailState = 'saving';
		const res = await fetch(`/api/thumb/${episodeId}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ atSec: video.currentTime })
		}).catch(() => null);
		thumbnailState = res?.ok ? 'done' : 'failed';
		setTimeout(() => (thumbnailState = 'idle'), 2000);
	}

	function onTimeUpdate() {
		if (Date.now() - lastSaved > 10_000) save();
	}

	async function onEnded() {
		await save();
		onended?.();
	}
</script>

<svelte:window onpagehide={save} />

<svelte:head>
	{@html cueStylesheet}
</svelte:head>

<div
	bind:this={wrapper}
	class={[
		playerSize.value === 'small' && 'mx-auto max-w-2xl',
		// Breaks out of the page container to the full window width, without needing fullscreen.
		playerSize.value === 'cinema' && 'relative left-1/2 w-screen -translate-x-1/2 bg-black'
	]}
>
	{#key episodeId}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={video}
			poster="/api/thumb/{episodeId}"
			controls
			crossorigin="anonymous"
			class={[
				'jc-video w-full bg-black',
				playerSize.value === 'cinema'
					? 'mx-auto block max-h-[calc(100dvh-3.5rem)]'
					: 'aspect-video rounded-md'
			]}
			ontimeupdate={onTimeUpdate}
			onpause={save}
			onseeked={save}
			onended={onEnded}
		>
			{#each subtitles as sub, i (sub.file)}
				<track
					kind="subtitles"
					src="/api/hls/{episodeId}/{sub.file}"
					srclang={sub.lang}
					label={sub.label}
					default={i === subtitleIndex}
				/>
			{/each}
		</video>
	{/key}
</div>

<div class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
	<div class="flex items-center gap-1">
		<span class="mr-1 text-zinc-400">Tamaño</span>
		{#each PLAYER_SIZES as size (size.value)}
			<button
				class={[
					'rounded px-2 py-0.5',
					playerSize.value === size.value
						? 'bg-amber-500 text-zinc-950'
						: 'text-zinc-300 hover:bg-zinc-800'
				]}
				onclick={() => chooseSize(size.value)}>{size.label}</button
			>
		{/each}
		{#if pipSupported}
			<button
				class={[
					'ml-2 rounded px-2 py-0.5',
					inPip ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-800'
				]}
				title="Sacar el vídeo a una ventana flotante"
				onclick={togglePip}>⧉ Flotante</button
			>
		{/if}
		<button
			class="ml-2 rounded px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
			title="Usar el fotograma que se ve ahora como miniatura del capítulo"
			disabled={thumbnailState === 'saving'}
			onclick={useAsThumbnail}
		>
			{{
				idle: '▣ Usar como miniatura',
				saving: 'Guardando…',
				done: '✓ Miniatura cambiada',
				failed: 'No se pudo cambiar'
			}[thumbnailState]}
		</button>
	</div>
	{#if audioTracks.length > 1}
		<div class="flex items-center gap-1">
			<span class="mr-1 text-zinc-400">Audio</span>
			{#each audioTracks as track, i (i)}
				<button
					class={[
						'rounded px-2 py-0.5',
						i === audioIndex ? 'bg-amber-500 text-zinc-950' : 'text-zinc-300 hover:bg-zinc-800'
					]}
					onclick={() => chooseAudio(i)}>{track.label}</button
				>
			{/each}
		</div>
	{/if}
	{#if subtitles.length}
		<div class="flex items-center gap-1">
			<span class="mr-1 text-zinc-400">Subtítulos</span>
			<button
				class={[
					'rounded px-2 py-0.5',
					subtitleIndex < 0 ? 'bg-amber-500 text-zinc-950' : 'text-zinc-300 hover:bg-zinc-800'
				]}
				onclick={() => chooseSubtitle(-1)}>No</button
			>
			{#each subtitles as sub, i (sub.file)}
				<button
					class={[
						'rounded px-2 py-0.5',
						i === subtitleIndex ? 'bg-amber-500 text-zinc-950' : 'text-zinc-300 hover:bg-zinc-800'
					]}
					onclick={() => chooseSubtitle(i)}>{sub.label}</button
				>
			{/each}
			<button
				class={[
					'ml-2 rounded px-2 py-0.5',
					showStylePanel ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-800'
				]}
				aria-expanded={showStylePanel}
				onclick={() => (showStylePanel = !showStylePanel)}>⚙ Estilo</button
			>
		</div>
	{/if}
</div>

{#if showStylePanel && subtitles.length}
	<SubtitleStylePanel
		style={subtitleStyle}
		previewImage="/api/thumb/{episodeId}"
		onchange={chooseStyle}
	/>
{/if}

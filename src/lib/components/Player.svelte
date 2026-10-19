<script lang="ts">
	import { onMount, tick, untrack, type Snippet } from 'svelte';
	import type Hls from 'hls.js';
	import { goto } from '$app/navigation';
	import '@fontsource/atkinson-hyperlegible/400.css';
	import '@fontsource/comic-neue/400.css';
	import { recoverFromErrors } from '#lib/hls-recovery.ts';
	import { normalizeLang, type AudioTrack, type SubtitleTrack } from '#lib/languages.ts';
	import { subtitleCss, type SubtitleStyle } from '#lib/subtitle-style.ts';
	import { thumbChanged, thumbUrl } from '#lib/thumb.svelte.ts';
	import { videoHere } from '#lib/video-here.svelte.ts';
	import { shownDeviceName } from '#lib/device-name.svelte.ts';
	import { page } from '$app/state';
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
		/** «Friends · T1 E2 · El de la boda»: what plays, for the kitchen panel. */
		title: string;
		startAt?: number | null;
		audioTracks: AudioTrack[];
		subtitles: SubtitleTrack[];
		settings: {
			audioLang: string | null;
			subtitleLang: string | null;
			subtitleStyle: SubtitleStyle;
			autoNext: boolean;
		};
		autoplay?: boolean;
		/**
		 * Called after the final position has been saved, with whether the next episode should
		 * start (the user's choice, under the video).
		 */
		onended?: (autoNext: boolean) => void;
		/** «Siguiente automático» changed, under the video: the page shows what goes with each. */
		onautonextchange?: (autoNext: boolean) => void;
		/** Over the video while it is given, e.g. the next episode with a countdown. */
		overlay?: Snippet;
	}

	let {
		episodeId,
		title,
		startAt = 0,
		audioTracks,
		subtitles,
		settings,
		autoplay = true,
		onended,
		onautonextchange,
		overlay
	}: Props = $props();

	let video = $state<HTMLVideoElement>();
	let hls: Hls | null = null;
	/** The connection lost or the server restarting: said, while it is tried again. */
	let problem = $state<string | null>(null);
	/** Where it is or a setting could not be saved (the connection, the session…): said, until one is. */
	let saveProblem = $state<string | null>(null);

	/** Saves go on in the background: a failed one is said, and the next that works takes it back. */
	function saved(failure: string) {
		return (res: Response | null) => {
			// 403: a child's time is over, which /descanso says.
			saveProblem = res?.ok || res?.status === 403 ? null : failure;
		};
	}
	let lastSaved = 0;

	const pick = <T extends { lang: string }>(tracks: T[], lang: string | null) =>
		lang ? tracks.findIndex((t) => t.lang === normalizeLang(lang)) : -1;

	// Overridden locally on change (and saved); fresh server data resets them.
	let audioLang = $derived(settings.audioLang);
	let subtitleLang = $derived(settings.subtitleLang);
	let subtitleStyle = $derived(settings.subtitleStyle);
	let autoNext = $derived(settings.autoNext);
	let showStylePanel = $state(false);

	// ::cue can't be styled inline, so the chosen style becomes a stylesheet. Values come from the
	// fixed option table in subtitle-style.ts, never from free text.
	const cueStylesheet = $derived.by(() => {
		const css = subtitleCss(subtitleStyle);
		return `<style>.jc-video::cue{font-family:${css.fontFamily};font-weight:${css.fontWeight};font-size:${css.fontScale}em;color:${css.color};background:${css.background};text-shadow:${css.textShadow};line-height:1.35}</style>`;
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

	// For the header's microphone: what plays here, to pause it while someone speaks.
	$effect(() => {
		const el = video;
		if (!el) return;
		videoHere.set({
			episodeId: untrack(() => episodeId),
			title: untrack(() => title),
			element: el
		});
		return () => videoHere.clear(el);
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
		const id = untrack(() => episodeId);
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
				// Out of a child's time (#18) the server refuses the video's pieces: the notice says why.
				instance.on(Hls.Events.ERROR, (_event, data) => {
					if (data.response?.code === 403) void goto('/descanso');
				});
				recoverFromErrors(instance, Hls, (text) => (problem = text));
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
			// Leaving the page or the episode inside the app: where it was, before hls.js empties the
			// <video>. Closing the tab is pagehide's. Only if it played: opened and left (the browser
			// may not let it start by itself), it stays as it was, e.g. out of «Seguir viendo».
			if (el.played.length) void saveAt(id, el);
			// Safari's own HLS: without its source the <video> lets go of the stream.
			if (!hls) {
				el.removeAttribute('src');
				el.load();
			}
			hls?.destroy();
			hls = null;
			problem = null;
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
		autoNext?: boolean;
	}) {
		fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(values)
		})
			.catch(() => null)
			.then(saved('No se pudo guardar el ajuste.'));
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

	const save = () => saveAt(episodeId, video);

	function saveAt(episodeId: number, video: HTMLVideoElement | undefined) {
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
				durationSec: video.duration,
				// Where, for a child's: /infantil says «Lucía está viendo… en el móvil».
				device: shownDeviceName(page.url.pathname.startsWith('/tv'))
			})
		})
			.catch(() => null)
			.then(saved('No se pudo guardar por dónde vas.'));
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
		if (res?.ok) thumbChanged(episodeId);
		setTimeout(() => (thumbnailState = 'idle'), 2000);
	}

	function onTimeUpdate() {
		if (Date.now() - lastSaved > 10_000) save();
	}

	async function onEnded() {
		await save();
		onended?.(autoNext);
	}

	function chooseAutoNext(value: boolean) {
		autoNext = value;
		onautonextchange?.(value);
		saveSetting({ autoNext });
	}
</script>

<svelte:window onpagehide={save} />

<svelte:head>
	{@html cueStylesheet}
</svelte:head>

<div
	bind:this={wrapper}
	class={[
		'relative',
		playerSize.value === 'small' && 'mx-auto max-w-2xl',
		// Breaks out of the page container to the full window width, without needing fullscreen.
		playerSize.value === 'cinema' && 'relative left-1/2 w-screen -translate-x-1/2 bg-black'
	]}
>
	{#key episodeId}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={video}
			poster={thumbUrl(episodeId)}
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
	{#if overlay}
		<div class="absolute inset-0 flex items-center justify-center rounded-md bg-black/75 p-4">
			{@render overlay()}
		</div>
	{/if}
</div>

{#if problem ?? saveProblem}
	<p class="mt-2 text-sm text-amber-400" role="status">{problem ?? saveProblem}</p>
{/if}

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
	<div class="flex items-center gap-1">
		<span class="mr-1 text-zinc-400">Al terminar</span>
		{#each [true, false] as value (value)}
			<button
				class={[
					'rounded px-2 py-0.5',
					autoNext === value ? 'bg-amber-500 text-zinc-950' : 'text-zinc-300 hover:bg-zinc-800'
				]}
				onclick={() => chooseAutoNext(value)}>{value ? 'Siguiente' : 'Parar'}</button
			>
		{/each}
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
		previewImage={thumbUrl(episodeId)}
		onchange={chooseStyle}
	/>
{/if}

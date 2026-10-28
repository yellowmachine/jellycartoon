<script lang="ts">
	import { onMount, tick, untrack, type Snippet } from 'svelte';
	import type Hls from 'hls.js';
	import { goto } from '$app/navigation';
	import '@fontsource/atkinson-hyperlegible/400.css';
	import '@fontsource/comic-neue/400.css';
	import { recoverFromErrors } from 'comun/hls-recovery.ts';
	import { normalizeLang, type AudioTrack, type SubtitleTrack } from 'comun/languages.ts';
	import { placeCues, subtitleCss, type SubtitleStyle } from '#lib/subtitle-style.ts';
	import { thumbChanged, thumbUrl } from 'comun/thumb.svelte.ts';
	import { useFrameAsBackdrop } from '#lib/backdrop.svelte.ts';
	import { videoHere } from '#lib/video-here.svelte.ts';
	import { watchMedia, watchPlay } from 'comun/media-diagnostics.ts';
	import { listenToEpisode } from 'comun/episode-listening.svelte.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { shownDeviceName } from 'comun/device-name.svelte.ts';
	import { page } from '$app/state';
	import SubtitleStylePanel from './SubtitleStylePanel.svelte';
	import SnapcastListen from './SnapcastListen.svelte';
	import { playerQuality, type Quality } from '#lib/player-quality.svelte.ts';
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
		/** Their Langua is set (Ajustes): «Mandar a Langua» in the menu. */
		langua?: boolean;
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
		overlay,
		langua = false
	}: Props = $props();

	let video = $state<HTMLVideoElement>();
	let hls: Hls | null = null;
	/** Its video in more than one quality (light.ts): the menu lets this device choose. */
	let qualities = $state(0);
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
		// The phrase before, rolled up and dimmed (#86): the new one is the bright one.
		return `<style>.jc-video::cue{font-family:${css.fontFamily};font-weight:${css.fontWeight};font-size:${css.fontScale}em;color:${css.color};background:${css.background};text-shadow:${css.textShadow};line-height:1.35}.jc-video::cue(.prev){opacity:0.55}</style>`;
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
	/** The ⚙ menu over the video: audio, subtitles, what follows, its size. */
	let menuOpen = $state(false);
	let menu = $state<HTMLDivElement>();

	onMount(() => {
		loadPlayerSize();
		pipSupported = 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
		// Custom elements: only in the browser. Its Spanish first: the buttons say their names when
		// they are made.
		void import('media-chrome/lang/es').then(() => import('media-chrome'));
	});

	// The menu closes on a touch outside it, or with Escape.
	$effect(() => {
		if (!menuOpen) return;
		const outside = (e: PointerEvent) => {
			const target = e.target as Element;
			if (!menu?.contains(target) && !target.closest?.('.jc-menu-button')) menuOpen = false;
		};
		const escape = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			menuOpen = false;
		};
		addEventListener('pointerdown', outside, true);
		addEventListener('keydown', escape, true);
		return () => {
			removeEventListener('pointerdown', outside, true);
			removeEventListener('keydown', escape, true);
		};
	});

	// With the screen off, what it does goes to the Registro: an episode that pauses by itself.
	$effect(() => {
		if (video) return watchMedia(video, 'vídeo');
	});

	// For the header's microphone: what plays here, to pause it while someone speaks.
	$effect(() => {
		const el = video;
		if (!el) return;
		videoHere.set({
			episodeId: untrack(() => episodeId),
			title: untrack(() => title),
			element: el,
			handOver: audioElsewhere
		});
		return () => videoHere.clear(el);
	});

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
				const instance = new Hls({
					startPosition: start || -1,
					// Its first guess of the connection, before measuring it: in automatic, the best to
					// begin with (the TV at home), not the light version until it has measured.
					...(untrack(() => playerQuality.value) === 'auto'
						? { abrEwmaDefaultEstimate: 50_000_000 }
						: {})
				});
				hls = instance;
				// The audio track list is not known yet at MANIFEST_PARSED.
				instance.once(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
					instance.audioTrack = untrack(() => audioIndex);
				});
				instance.on(Hls.Events.MANIFEST_PARSED, () => {
					qualities = instance.levels.length;
					applyQuality(
						instance,
						untrack(() => playerQuality.value),
						false
					);
					if (untrack(() => autoplay)) watchPlay(el.play(), 'vídeo');
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
						if (untrack(() => autoplay)) watchPlay(el.play(), 'vídeo');
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
			if (el.played.length && !handedOver) void saveAt(id, el);
			// Safari's own HLS: without its source the <video> lets go of the stream.
			if (!hls) {
				el.removeAttribute('src');
				el.load();
			}
			hls?.destroy();
			hls = null;
			qualities = 0;
			problem = null;
		};
	});

	/**
	 * «light»: the lightest of its versions, and never above it; «auto», hls.js chooses. `now`:
	 * changed while playing, from the next piece.
	 */
	function applyQuality(instance: Hls, quality: Quality, now: boolean) {
		if (instance.levels.length < 2) return;
		const lightest = instance.levels.reduce(
			(best, level, i) => (level.bitrate < instance.levels[best].bitrate ? i : best),
			0
		);
		instance.autoLevelCapping = quality === 'light' ? lightest : -1;
		if (now) instance.nextLevel = quality === 'light' ? lightest : -1;
	}

	function chooseQuality(quality: Quality) {
		playerQuality.set(quality);
		if (hls) applyQuality(hls, quality, true);
	}

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

	// Their height (the panel, or Ajustes): set on each cue as it shows, and again when chosen.
	let placing: ReturnType<typeof placeCues> | null = null;
	$effect(() => {
		const el = video;
		if (!el) return;
		placing = placeCues(el, () => untrack(() => subtitleCss(subtitleStyle).line));
		return () => {
			placing?.stop();
			placing = null;
		};
	});
	$effect(() => {
		void subtitleStyle.position;
		untrack(() => placing?.again());
	});

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

	/**
	 * Given to the music player («Seguir solo con el audio»): where it goes is the audio's, and the
	 * video, stopped where it was given, saves nothing more (leaving the page would undo what was
	 * listened to).
	 */
	let handedOver = false;
	const save = () => (handedOver ? Promise.resolve() : saveAt(episodeId, video));

	/**
	 * Played here again while its audio goes on in the music player: that stops, and the video goes
	 * on from where the audio got to.
	 */
	function playedHere() {
		const listening = music.listening;
		if (listening?.id === episodeId && video) {
			const at = listening.positionSec;
			music.stop();
			video.currentTime = at;
		}
		handedOver = false;
	}

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

	/**
	 * «Seguir solo con el audio» (#154): from this second, with the audio being heard, in the music
	 * player, which goes on with the screen off (Chrome pauses a video then). The video stops here.
	 */
	function onlyAudio() {
		if (!video) return;
		// «Friends · T1 E2 · El de la boda»: the episode's title, and the rest under it.
		const parts = title.split(' · ');
		listenToEpisode({
			id: episodeId,
			title: parts.length > 1 ? parts.at(-1)! : title,
			subtitle: parts.length > 1 ? parts.slice(0, -1).join(' · ') : 'Solo el audio',
			audioTracks,
			lang: null,
			track: audioIndex,
			durationSec: Number.isFinite(video.duration) ? video.duration : null,
			positionSec: video.currentTime
		});
		video.pause();
		handedOver = true;
		menuOpen = false;
	}

	/** It goes on on Snapcast (#223), which saves its progress from now: the video stops here. */
	function audioElsewhere() {
		handedOver = true;
		video?.pause();
		menuOpen = false;
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

	let backdropState = $state<'idle' | 'saving' | 'done' | 'failed'>('idle');

	/** The frame on screen goes behind the top of the series' page (backdrop.ts). */
	async function useAsBackdrop() {
		if (!video) return;
		backdropState = 'saving';
		backdropState = (await useFrameAsBackdrop(episodeId, video.currentTime)) ? 'done' : 'failed';
		setTimeout(() => (backdropState = 'idle'), 2000);
	}

	/** Its name, numbered if another has the same («English 1», «English 2»). */
	function trackLabel(tracks: { label: string }[], i: number) {
		const label = tracks[i]!.label;
		const same = tracks.filter((t) => t.label === label);
		return same.length > 1
			? `${label} ${tracks.slice(0, i + 1).filter((t) => t.label === label).length}`
			: label;
	}

	/** A clip sent to Langua: what it said (sent, or why not). */
	let languaState = $state<string | null>(null);
	async function toLangua(minutes: number) {
		if (!video) return;
		languaState = 'Mandando…';
		const res = await fetch('/api/langua/clip', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				episodeId,
				positionSec: video.currentTime,
				minutes,
				// The audio heard, which may not be the one in Ajustes.
				language: audioTracks[audioIndex]?.lang ?? null
			})
		}).catch(() => null);
		const body = await res?.json().catch(() => null);
		languaState = body?.message ?? 'No se pudo mandar.';
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
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- a <style> for the subtitles, made from the settings' numbers and colours. -->
	{@html cueStylesheet}
</svelte:head>

<!-- Media Chrome's controls over our own <video> (hls.js, the subtitles' style, the saves): the
same look in every browser, the app's colours, and the player's options in its ⚙ menu. -->
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
		<media-controller
			lang="es"
			class={[
				'jc-player block w-full overflow-hidden bg-black',
				playerSize.value === 'cinema'
					? 'mx-auto max-h-[calc(100dvh-3.5rem)]'
					: 'aspect-video rounded-md'
			]}
		>
			<video
				slot="media"
				bind:this={video}
				poster={thumbUrl(episodeId)}
				crossorigin="anonymous"
				class="jc-video h-full w-full bg-black"
				ontimeupdate={onTimeUpdate}
				onpause={save}
				onplay={playedHere}
				onseeked={save}
				onended={onEnded}
			>
				{#each subtitles as sub, i (sub.file)}
					<!-- Whisper's in the form chosen in «⚙ Estilo»: two lines that stay, or rolling up. -->
					<track
						kind="subtitles"
						src="/api/hls/{episodeId}/{sub.file}{sub.file.startsWith('sub_auto_')
							? `?forma=${subtitleStyle.automatic}`
							: ''}"
						srclang={sub.lang}
						label={sub.label}
						default={i === subtitleIndex}
					/>
				{/each}
			</video>
			<media-loading-indicator slot="centered-chrome" noautohide></media-loading-indicator>
			<!-- Touch: a tap shows the controls and this, big in the middle; a second, play or pause. -->
			<media-play-button slot="centered-chrome" class="jc-center-play"></media-play-button>
			<media-control-bar>
				<media-play-button></media-play-button>
				<media-seek-backward-button seekoffset="10"></media-seek-backward-button>
				<media-seek-forward-button seekoffset="10"></media-seek-forward-button>
				<media-time-range></media-time-range>
				<media-time-display showduration></media-time-display>
				<media-mute-button></media-mute-button>
				<media-volume-range></media-volume-range>
				<button
					class="jc-menu-button"
					aria-label="Opciones"
					aria-expanded={menuOpen}
					title="Audio, subtítulos, tamaño…"
					onclick={() => (menuOpen = !menuOpen)}
				>
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="h-6 w-6"
						aria-hidden="true"
						><circle cx="12" cy="12" r="3" /><path
							d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"
						/></svg
					>
				</button>
				{#if pipSupported}
					<media-pip-button></media-pip-button>
				{/if}
				<media-fullscreen-button></media-fullscreen-button>
			</media-control-bar>

			{#if menuOpen}
				<!-- Inside the controller: still there in fullscreen. Not role="dialog": Media Chrome leaves
				those without pointer events, and a touch went through to the video (play/pause). -->
				<div
					bind:this={menu}
					class="absolute right-3 bottom-14 z-10 max-h-[calc(100%-5rem)] w-72 space-y-3 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950/95 p-3 text-sm shadow-2xl"
					role="group"
					aria-label="Opciones del vídeo"
				>
					{#if !page.data.kid && audioTracks.length}
						<button
							class="w-full rounded px-2 py-1.5 text-left text-zinc-300 hover:bg-zinc-800"
							title="Sigue desde aquí en el reproductor de música, que no se para con la pantalla apagada"
							onclick={onlyAudio}>🎧 Seguir solo con el audio</button
						>
						{#if page.data.snapcast}
							<SnapcastListen
								{episodeId}
								startSec={() => video?.currentTime ?? null}
								itemClass="w-full rounded px-2 py-1.5 text-left text-zinc-300 hover:bg-zinc-800"
								onsent={audioElsewhere}
							/>
						{/if}
					{/if}
					{#if qualities > 1}
						<!-- Per device: the phone away from home in the light one (light.ts). -->
						{@render choices('Calidad', [
							{
								label: 'Automática',
								on: playerQuality.value === 'auto',
								pick: () => chooseQuality('auto')
							},
							{
								label: 'Ligera (720p)',
								on: playerQuality.value === 'light',
								pick: () => chooseQuality('light')
							}
						])}
					{/if}
					{#if audioTracks.length > 1}
						{@render choices(
							'Audio',
							audioTracks.map((t, i) => ({
								label: trackLabel(audioTracks, i),
								on: i === audioIndex,
								pick: () => chooseAudio(i)
							}))
						)}
					{/if}
					{#if subtitles.length}
						{@render choices('Subtítulos', [
							{ label: 'No', on: subtitleIndex < 0, pick: () => chooseSubtitle(-1) },
							...subtitles.map((s, i) => ({
								label: trackLabel(subtitles, i),
								on: i === subtitleIndex,
								pick: () => chooseSubtitle(i)
							}))
						])}
						<button
							class="w-full rounded px-2 py-1.5 text-left text-zinc-300 hover:bg-zinc-800"
							aria-expanded={showStylePanel}
							onclick={() => {
								showStylePanel = !showStylePanel;
								menuOpen = false;
							}}>{showStylePanel ? 'Ocultar el estilo' : 'Estilo de los subtítulos…'}</button
						>
					{/if}
					{@render choices('Al terminar', [
						{ label: 'Siguiente', on: autoNext, pick: () => chooseAutoNext(true) },
						{ label: 'Parar', on: !autoNext, pick: () => chooseAutoNext(false) }
					])}
					{@render choices(
						'Tamaño',
						PLAYER_SIZES.map((s) => ({
							label: s.label,
							on: playerSize.value === s.value,
							pick: () => chooseSize(s.value)
						}))
					)}
					{#if langua}
						{@render choices(
							'Mandar a Langua',
							[1, 2, 5].map((m) => ({
								label: `Últimos ${m} min`,
								on: false,
								pick: () => toLangua(m)
							}))
						)}
						{#if languaState}
							<p class="px-2 text-zinc-400" role="status">{languaState}</p>
						{/if}
					{/if}
					<button
						class="w-full rounded px-2 py-1.5 text-left text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
						title="Usar el fotograma que se ve ahora como miniatura del capítulo"
						disabled={thumbnailState === 'saving'}
						onclick={useAsThumbnail}
					>
						{{
							idle: 'Usar este fotograma como miniatura',
							saving: 'Guardando…',
							done: '✓ Miniatura cambiada',
							failed: 'No se pudo cambiar'
						}[thumbnailState]}
					</button>
					{#if !page.data.kid}
						<button
							class="w-full rounded px-2 py-1.5 text-left text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
							title="Poner el fotograma que se ve ahora arriba en la página de la serie"
							disabled={backdropState === 'saving'}
							onclick={useAsBackdrop}
						>
							{{
								idle: 'Usar este fotograma de fondo de la serie',
								saving: 'Guardando…',
								done: '✓ Fondo cambiado',
								failed: 'No se pudo cambiar'
							}[backdropState]}
						</button>
					{/if}
				</div>
			{/if}

			{#if overlay}
				<div class="absolute inset-0 z-20 flex items-center justify-center bg-black/75 p-4">
					{@render overlay()}
				</div>
			{/if}
		</media-controller>
	{/key}
</div>

{#snippet choices(label: string, options: { label: string; on: boolean; pick: () => void }[])}
	<div>
		<p class="mb-1 px-2 text-xs tracking-wide text-zinc-500 uppercase">{label}</p>
		<div class="flex flex-wrap gap-1">
			<!-- By place: two tracks may have the same name (an extra with two «English»). -->
			{#each options as option, i (i)}
				<button
					class={[
						'rounded px-2 py-1',
						option.on ? 'bg-amber-500 text-zinc-950' : 'text-zinc-300 hover:bg-zinc-800'
					]}
					aria-pressed={option.on}
					onclick={option.pick}>{option.label}</button
				>
			{/each}
		</div>
	</div>
{/snippet}

{#if problem ?? saveProblem}
	<p class="mt-2 text-sm text-amber-400" role="status">{problem ?? saveProblem}</p>
{/if}

{#if showStylePanel && subtitles.length}
	<SubtitleStylePanel
		style={subtitleStyle}
		previewImage={thumbUrl(episodeId)}
		onchange={chooseStyle}
	/>
{/if}

<style>
	/* The app's colours on Media Chrome's controls: zinc, and amber for what moves. */
	.jc-player {
		--media-primary-color: var(--color-zinc-100);
		--media-secondary-color: transparent;
		--media-control-background: transparent;
		--media-control-hover-background: rgb(255 255 255 / 0.1);
		--media-range-bar-color: var(--color-amber-400);
		--media-range-track-background: rgb(255 255 255 / 0.25);
		--media-range-thumb-background: var(--color-amber-400);
		--media-font-family: inherit;
		--media-font-size: 0.875rem;
		--media-tooltip-display: none;
	}
	.jc-player media-control-bar {
		background: linear-gradient(transparent, rgb(9 9 11 / 0.85));
		padding: 0 0.25rem;
	}
	.jc-center-play {
		--media-button-icon-width: 3.5rem;
		--media-button-icon-height: 3.5rem;
		--media-control-background: rgb(9 9 11 / 0.6);
		--media-control-hover-background: rgb(9 9 11 / 0.8);
		border-radius: 9999px;
		padding: 1rem;
	}
	.jc-menu-button {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 0.6rem;
		color: var(--color-zinc-100);
		background: transparent;
	}
	.jc-menu-button:hover,
	.jc-menu-button[aria-expanded='true'] {
		background: rgb(255 255 255 / 0.1);
		color: var(--color-amber-400);
	}
</style>

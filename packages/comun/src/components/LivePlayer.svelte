<script lang="ts">
	import { untrack } from 'svelte';
	import type Hls from 'hls.js';
	import '@fontsource/atkinson-hyperlegible/400.css';
	import '@fontsource/comic-neue/400.css';
	import { recoverFromErrors } from 'comun/hls-recovery.ts';
	import { BROADCAST_TRACKS, languageLabel } from 'comun/languages.ts';
	import { placeCues, subtitleCss, type SubtitleStyle } from 'comun/subtitle-style.ts';

	/**
	 * A TV channel, live, in this browser: its own audios (the original version) and subtitles, as the
	 * stream brings them, with the user's subtitle style. In both apps (#253); what only the house
	 * does, it lends: `here`, the microphone and the kitchen knowing it plays; `report`, where it is
	 * every few seconds (a child's time, #18, and what is watched).
	 */

	let {
		url,
		subtitleStyle,
		here,
		report
	}: {
		url: string;
		subtitleStyle: SubtitleStyle;
		/** It plays in this element: what stops that, back. */
		here?: (element: HTMLVideoElement) => () => void;
		/** Where it is, playing; called every EVERY_MS. */
		report?: (positionSec: number) => Promise<void>;
	} = $props();

	/** As often as the episodes' player saves: a child's time is counted from these. */
	const EVERY_MS = 10_000;

	let video = $state<HTMLVideoElement>();
	let hls = $state<Hls | null>(null);

	interface Choice {
		index: number;
		label: string;
	}
	let audios = $state<Choice[]>([]);
	let audioIndex = $state(-1);
	let subtitles = $state<Choice[]>([]);
	let subtitleIndex = $state(-1);
	/** A channel off the air, or the connection lost: said, while it is tried again. */
	let problem = $state<string | null>(null);

	/** The same audio comes once per quality (RTVE: «Castellano» four times): one is enough. */
	function choices(tracks: { name: string; lang?: string }[]) {
		const seen = new Set<string>();
		return tracks.flatMap((t, index) => {
			const label = (t.lang && BROADCAST_TRACKS[t.lang]) || t.name || languageLabel(t.lang);
			if (seen.has(label)) return [];
			seen.add(label);
			return [{ index, label }];
		});
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

	// As in the episodes' player: ::cue can't be styled inline.
	const cueStylesheet = $derived.by(() => {
		const css = subtitleCss(subtitleStyle);
		return `<style>.jc-video::cue{font-family:${css.fontFamily};font-size:${css.fontScale}em;color:${css.color};background:${css.background};text-shadow:${css.textShadow};line-height:1.35}</style>`;
	});

	$effect(() => {
		const el = video;
		if (!el || !here) return;
		return untrack(() => here(el));
	});

	$effect(() => {
		const el = video;
		const src = url;
		if (!el) return;
		let cancelled = false;
		let instance: Hls | null = null;

		(async () => {
			const { default: Hls } = await import('hls.js');
			if (cancelled) return;
			if (Hls.isSupported()) {
				instance = new Hls();
				hls = instance;
				instance.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
					audios = choices(instance!.audioTracks);
					audioIndex = instance!.audioTrack;
				});
				instance.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => (audioIndex = data.id));
				instance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
					subtitles = choices(instance!.subtitleTracks);
					subtitleIndex = instance!.subtitleTrack;
				});
				instance.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => (subtitleIndex = data.id));
				instance.on(Hls.Events.MANIFEST_PARSED, () => el.play().catch(() => {}));
				recoverFromErrors(instance, Hls, (text) => (problem = text));
				instance.loadSource(src);
				instance.attachMedia(el);
			} else if (el.canPlayType('application/vnd.apple.mpegurl')) {
				// Safari plays HLS natively, with its own menu for audios and subtitles.
				el.src = src;
				el.play().catch(() => {});
			}
		})();

		// Paused, the position stays: nothing counts.
		const timer = setInterval(() => {
			if (!el.paused && report && !cancelled) void report(el.currentTime);
		}, EVERY_MS);

		return () => {
			cancelled = true;
			clearInterval(timer);
			instance?.destroy();
			// Safari's own HLS: without its source the <video> lets go of the stream.
			if (!instance) {
				el.removeAttribute('src');
				el.load();
			}
			hls = null;
			audios = [];
			subtitles = [];
			problem = null;
		};
	});

	const choice = (on: boolean) => [
		'rounded px-2 py-0.5',
		on ? 'bg-amber-500 text-zinc-950' : 'text-zinc-300 hover:bg-zinc-800'
	];
</script>

<svelte:head>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- a <style> for the subtitles, made from the settings' numbers and colours. -->
	{@html cueStylesheet}
</svelte:head>

<video
	bind:this={video}
	controls
	playsinline
	crossorigin="anonymous"
	class="jc-video aspect-video w-full rounded-md bg-black"
></video>

{#if problem}
	<p class="mt-2 text-sm text-amber-400" role="status">{problem}</p>
{/if}

{#if audios.length > 1 || subtitles.length}
	<div class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
		{#if audios.length > 1}
			<div class="flex flex-wrap items-center gap-1">
				<span class="mr-1 text-zinc-400">Audio</span>
				{#each audios as track (track.index)}
					<button
						class={choice(track.index === audioIndex)}
						onclick={() => hls && (hls.audioTrack = track.index)}>{track.label}</button
					>
				{/each}
			</div>
		{/if}
		{#if subtitles.length}
			<div class="flex flex-wrap items-center gap-1">
				<span class="mr-1 text-zinc-400">Subtítulos</span>
				<button class={choice(subtitleIndex < 0)} onclick={() => hls && (hls.subtitleTrack = -1)}
					>No</button
				>
				{#each subtitles as track (track.index)}
					<button
						class={choice(track.index === subtitleIndex)}
						onclick={() => hls && (hls.subtitleTrack = track.index)}>{track.label}</button
					>
				{/each}
			</div>
		{/if}
	</div>
{/if}

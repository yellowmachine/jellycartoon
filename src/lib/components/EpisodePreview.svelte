<script module lang="ts">
	/** The one playing: a new one stops it. */
	let playing: (() => void) | null = null;
</script>

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type Hls from 'hls.js';

	/**
	 * A few seconds of the episode over its thumbnail while the mouse is on its card, or the focus
	 * (the TV view's remote): muted, from 30% in, and stopped on its last frame. Straight from its
	 * HLS video, without the audio. Goes inside the thumbnail's box (`relative`); its card is the
	 * link or button around it.
	 */
	let { id, durationSec }: { id: number; durationSec: number | null } = $props();

	/** Resting on a card this long before it starts, so passing over cards does not. */
	const WAIT_MS = 500;
	const CLIP_SEC = 10;

	let box = $state<HTMLDivElement>();
	let video = $state<HTMLVideoElement>();
	let shown = $state(false);
	let started = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let hls: Hls | null = null;

	function arm() {
		clearTimeout(timer);
		if (durationSec) timer = setTimeout(start, WAIT_MS);
	}

	function stop() {
		clearTimeout(timer);
		hls?.destroy();
		hls = null;
		shown = started = false;
		if (playing === stop) playing = null;
	}

	async function start() {
		playing?.();
		playing = stop;
		shown = true;
		await tick();
		const el = video;
		if (!el || playing !== stop) return;
		const from = durationSec! * 0.3;
		el.addEventListener('timeupdate', () => {
			if (el.currentTime < from + CLIP_SEC) return;
			el.pause();
			hls?.stopLoad();
		});
		const url = `/api/hls/${id}/video/index.m3u8`;
		const { default: Hls } = await import('hls.js');
		if (playing !== stop) return;
		if (Hls.isSupported()) {
			hls = new Hls({
				startPosition: from,
				maxBufferLength: CLIP_SEC,
				maxMaxBufferLength: CLIP_SEC
			});
			// Nothing past the clip: a piece of a 1080p episode can be 10 MB or more.
			hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
				if (data.frag.end >= from + CLIP_SEC) hls?.stopLoad();
			});
			// Out of a child's time, or any other failure: the thumbnail stays.
			hls.on(Hls.Events.ERROR, (_event, data) => {
				if (data.fatal) stop();
			});
			hls.loadSource(url);
			hls.attachMedia(el);
		} else if (el.canPlayType('application/vnd.apple.mpegurl')) {
			el.src = url;
			el.addEventListener('loadedmetadata', () => (el.currentTime = from), { once: true });
		}
		el.play().catch(() => {});
	}

	onMount(() => {
		const card = box?.closest('a, button');
		if (!card) return;
		// The mouse only: a tap on a phone opens the episode.
		const enter = (e: Event) => (e as PointerEvent).pointerType === 'mouse' && arm();
		card.addEventListener('pointerenter', enter);
		card.addEventListener('pointerleave', stop);
		card.addEventListener('focus', arm);
		card.addEventListener('blur', stop);
		return () => {
			card.removeEventListener('pointerenter', enter);
			card.removeEventListener('pointerleave', stop);
			card.removeEventListener('focus', arm);
			card.removeEventListener('blur', stop);
			stop();
		};
	});
</script>

<div bind:this={box} class="pointer-events-none absolute inset-0">
	{#if shown}
		<!-- Seen once it plays: no black box while it loads. -->
		<video
			bind:this={video}
			muted
			playsinline
			class={[
				'h-full w-full object-cover transition-opacity',
				started ? 'opacity-100' : 'opacity-0'
			]}
			onplaying={() => (started = true)}
		></video>
	{/if}
</div>

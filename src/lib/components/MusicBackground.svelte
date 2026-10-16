<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { coverPalette, drawAurora, mixPalette, type Palette } from '#lib/aurora.ts';
	import { coverUrl } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import { watchSnapcast } from '#lib/music-target.svelte.ts';

	/**
	 * Behind the Música pages: an aurora with the colours of the cover of what is playing, here or
	 * on Snapcast; with nothing on, the album being looked at. It drifts only while music plays.
	 */
	let { snapcast }: { snapcast: boolean } = $props();
	// svelte-ignore state_referenced_locally
	const snap = snapcast ? watchSnapcast() : null;

	/** How strong the colours are, and how fast they drift: the ones chosen in the trial page. */
	const INTENSITY = 0.55;
	const PACE = 2;

	const source = $derived.by(() => {
		const s = snap?.state;
		const local = music.radio ? undefined : music.current;
		const onSnapcast = s?.active && !s.radio ? s.track : null;
		if (onSnapcast && !s!.paused)
			return { albumId: onSnapcast.albumId, hasCover: onSnapcast.hasCover, playing: true };
		if (local && music.playing)
			return { albumId: local.albumId, hasCover: local.hasCover, playing: true };
		if (onSnapcast)
			return { albumId: onSnapcast.albumId, hasCover: onSnapcast.hasCover, playing: false };
		if (local) return { albumId: local.albumId, hasCover: local.hasCover, playing: false };
		const album = page.data.album as { id: number; hasCover: boolean } | undefined;
		return album ? { albumId: album.id, hasCover: album.hasCover, playing: false } : null;
	});

	/** What it is drawn with now, what it is heading to, and whether it shows at all. */
	let shown: Palette | null = null;
	let target: Palette | null = null;
	/** From one album's colours to the next: where it starts, and how far it has gone (0 to 1). */
	let from: Palette | null = null;
	let blend = 1;
	/** Something changed while it stands still: one frame to draw it. */
	let dirty = false;
	let visible = $state(false);

	$effect(() => {
		const url = source?.hasCover ? coverUrl(source.albumId) : null;
		if (!url) {
			visible = false;
			return;
		}
		let current = true;
		coverPalette(url).then((p) => {
			if (!current) return;
			if (!p) {
				visible = false;
				return;
			}
			if (shown) {
				from = shown;
				blend = 0;
			} else {
				shown = p;
			}
			target = p;
			dirty = true;
			visible = true;
		});
		return () => {
			current = false;
		};
	});

	let canvas = $state<HTMLCanvasElement>();

	onMount(() => {
		const ctx = canvas!.getContext('2d')!;
		const reduced = matchMedia('(prefers-reduced-motion: reduce)');
		let clock = 20;
		let last = performance.now();
		let lastFrame = 0;
		let raf = 0;
		let w = 0;
		let h = 0;

		function resize() {
			// Small on purpose: it is a blur, and the browser scales it up.
			const scale = Math.min(devicePixelRatio || 1, 1) * 0.5;
			w = Math.max(1, Math.round(innerWidth * scale));
			h = Math.max(1, Math.round(innerHeight * scale));
			canvas!.width = w;
			canvas!.height = h;
			if (shown) drawAurora(ctx, w, h, clock, shown, INTENSITY);
		}

		function frame(now: number) {
			raf = requestAnimationFrame(frame);
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			if (!target) return;
			const moving = Boolean(source?.playing) && !reduced.matches;
			if (moving) clock += dt * PACE;
			// From one album's colours to the next in two seconds.
			if (blend < 1) blend = Math.min(1, blend + dt / 2);
			// About 20 frames a second is plenty for something this slow.
			if (!(moving || blend < 1 || dirty) || now - lastFrame < 50) return;
			lastFrame = now;
			dirty = false;
			shown =
				blend < 1 && from ? mixPalette(from, target, blend * blend * (3 - 2 * blend)) : target;
			drawAurora(ctx, w, h, clock, shown, INTENSITY);
		}

		resize();
		addEventListener('resize', resize);
		raf = requestAnimationFrame(frame);
		return () => {
			cancelAnimationFrame(raf);
			removeEventListener('resize', resize);
		};
	});
</script>

<!-- Behind everything, and a dark layer over it so that text always reads. -->
<div
	class={[
		'pointer-events-none fixed inset-0 -z-10 transition-opacity duration-[1500ms]',
		visible ? 'opacity-100' : 'opacity-0'
	]}
	aria-hidden="true"
>
	<canvas bind:this={canvas} class="h-full w-full"></canvas>
	<div class="absolute inset-0 bg-zinc-950/35"></div>
</div>

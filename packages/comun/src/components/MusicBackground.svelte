<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		coverPalette,
		drawBackground,
		mixPalette,
		pace,
		type Palette
	} from 'comun/music-background.ts';
	import { musicBackground } from 'comun/music-background-settings.svelte.ts';
	import { coverUrl } from 'comun/music.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { watchSnapcast } from 'comun/music-target.svelte.ts';

	/**
	 * Behind the Música pages: an aurora with the colours of the cover of what is playing, here or
	 * on Snapcast; with nothing on, the album being looked at. It drifts only while music plays.
	 */
	let { snapcast }: { snapcast: boolean } = $props();
	// svelte-ignore state_referenced_locally
	const snap = snapcast ? watchSnapcast() : null;

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
	/** Draws again if it had stopped: it only runs while something moves or changes. */
	let wake = () => {};

	// What it is drawn with changed: in Ajustes, or what is playing.
	$effect(() => {
		void [
			musicBackground.style,
			musicBackground.intensity,
			musicBackground.speed,
			source?.albumId,
			source?.playing
		];
		wake();
	});

	$effect(() => {
		const url =
			source?.hasCover && musicBackground.style !== 'none' ? coverUrl(source.albumId) : null;
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
			wake();
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
			// The aurora small on purpose: it is a blur, and the browser scales it up. Lines and dots,
			// at the screen's size.
			const scale =
				Math.min(devicePixelRatio || 1, 1) * (musicBackground.style === 'aurora' ? 0.5 : 1);
			w = Math.max(1, Math.round(innerWidth * scale));
			h = Math.max(1, Math.round(innerHeight * scale));
			canvas!.width = w;
			canvas!.height = h;
			dirty = true;
			wake();
		}

		const draw = (p: Palette) => {
			const style = musicBackground.style;
			if (style !== 'none')
				drawBackground(ctx, w, h, style, source?.albumId ?? 0, clock, p, musicBackground.intensity);
		};
		// A change in Ajustes on another tab is not seen here; one here, at once.
		let drawnWith = '';

		function frame(now: number) {
			raf = 0;
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			// Nothing to draw yet: it is woken when the colours arrive.
			if (!target) return;
			const moving = Boolean(source?.playing) && !reduced.matches;
			if (moving) clock += dt * pace(musicBackground.speed);
			const settings = `${musicBackground.style}:${musicBackground.intensity}:${source?.albumId}`;
			if (settings !== drawnWith) {
				if (!drawnWith.startsWith(musicBackground.style)) resize();
				drawnWith = settings;
				dirty = true;
			}
			// From one album's colours to the next in two seconds.
			if (blend < 1) blend = Math.min(1, blend + dt / 2);
			// Standing still, with nothing new: no more frames until something wakes it.
			if (!(moving || blend < 1 || dirty)) return;
			// resize() above may have woken it already: one loop only.
			raf ||= requestAnimationFrame(frame);
			// About 20 frames a second is plenty for something this slow.
			if (now - lastFrame < 50) return;
			lastFrame = now;
			dirty = false;
			shown =
				blend < 1 && from ? mixPalette(from, target, blend * blend * (3 - 2 * blend)) : target;
			draw(shown);
		}

		wake = () => {
			if (raf) return;
			last = performance.now();
			raf = requestAnimationFrame(frame);
		};
		const motionChanged = () => wake();
		resize();
		addEventListener('resize', resize);
		reduced.addEventListener('change', motionChanged);
		return () => {
			cancelAnimationFrame(raf);
			raf = 0;
			wake = () => {};
			removeEventListener('resize', resize);
			reduced.removeEventListener('change', motionChanged);
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

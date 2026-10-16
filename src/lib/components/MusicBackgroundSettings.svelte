<script lang="ts">
	import { onMount } from 'svelte';
	import {
		BACKGROUND_STYLES,
		drawBackground,
		pace,
		SAMPLE_PALETTE
	} from '#lib/music-background.ts';
	import { musicBackground } from '#lib/music-background-settings.svelte.ts';

	/** The Música background on this device: its style, how strong and how fast, with a preview. */

	const styles = [{ key: 'none' as const, label: 'Ninguno' }, ...BACKGROUND_STYLES];
	const button = (on: boolean) => [
		'rounded-full border px-3 py-1 text-sm',
		on ? 'border-amber-500 text-amber-400' : 'border-zinc-700 hover:bg-zinc-900'
	];

	let canvas = $state<HTMLCanvasElement>();

	// The preview always moves, as if music were playing: it is there to see the movement.
	onMount(() => {
		const ctx = canvas!.getContext('2d')!;
		let clock = 20;
		let last = performance.now();
		let raf = 0;
		function frame(now: number) {
			raf = requestAnimationFrame(frame);
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			const style = musicBackground.style;
			const { width, height } = canvas!.getBoundingClientRect();
			// The aurora small, as on the Música pages; lines and dots at the preview's size.
			const scale = style === 'aurora' ? 0.5 : Math.min(devicePixelRatio || 1, 1.5);
			const w = Math.max(1, Math.round(width * scale));
			const h = Math.max(1, Math.round(height * scale));
			if (canvas!.width !== w || canvas!.height !== h) {
				canvas!.width = w;
				canvas!.height = h;
			}
			if (style === 'none') {
				ctx.clearRect(0, 0, w, h);
				return;
			}
			clock += dt * pace(musicBackground.speed);
			drawBackground(ctx, w, h, style, 1687, clock, SAMPLE_PALETTE, musicBackground.intensity);
		}
		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	});
</script>

<div class="space-y-4">
	<div class="flex flex-wrap gap-2" role="group" aria-label="Estilo del fondo">
		{#each styles as s (s.key)}
			<button
				type="button"
				class={button(musicBackground.style === s.key)}
				aria-pressed={musicBackground.style === s.key}
				onclick={() => musicBackground.set({ style: s.key })}>{s.label}</button
			>
		{/each}
	</div>

	{#if musicBackground.style !== 'none'}
		<div class="grid gap-3 sm:grid-cols-2">
			<label class="flex items-center gap-3 text-sm text-zinc-300">
				Intensidad
				<input
					id="background-intensity"
					type="range"
					min="10"
					max="100"
					value={Math.round(musicBackground.intensity * 100)}
					oninput={(e) => musicBackground.set({ intensity: Number(e.currentTarget.value) / 100 })}
					class="min-w-0 flex-1 accent-amber-500"
				/>
			</label>
			<label class="flex items-center gap-3 text-sm text-zinc-300">
				Velocidad
				<input
					id="background-speed"
					type="range"
					min="0"
					max="100"
					value={Math.round(musicBackground.speed * 100)}
					oninput={(e) => musicBackground.set({ speed: Number(e.currentTarget.value) / 100 })}
					class="min-w-0 flex-1 accent-amber-500"
				/>
			</label>
		</div>
	{/if}

	<!-- With the colours of a cover, and the dark layer of the Música pages over it. -->
	<div class="relative h-40 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
		<canvas bind:this={canvas} class="absolute inset-0 h-full w-full" aria-hidden="true"></canvas>
		<div class="absolute inset-0 bg-zinc-950/35"></div>
		<p class="absolute bottom-2 left-3 text-xs text-zinc-400">
			{musicBackground.style === 'none'
				? 'Sin fondo: el de siempre.'
				: 'Vista previa, con los colores de una portada.'}
		</p>
	</div>
</div>

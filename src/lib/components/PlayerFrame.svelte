<script lang="ts">
	import { page } from '$app/state';
	import type { PlayerMenu } from 'comun/components/Player.svelte';
	import { thumbChanged } from 'comun/thumb.svelte.ts';
	import { useFrameAsBackdrop } from '#lib/backdrop.svelte.ts';

	/**
	 * Last in the player's ⚙ menu, the house's: a clip to Langua (Ajustes), and the frame on screen
	 * as the episode's thumbnail or the series' background.
	 */
	let { menu, langua = false }: { menu: PlayerMenu; langua?: boolean } = $props();

	/** A clip sent to Langua: what it said (sent, or why not). */
	let languaState = $state<string | null>(null);
	async function toLangua(minutes: number) {
		const video = menu.video();
		if (!video) return;
		languaState = 'Mandando…';
		const res = await fetch('/api/langua/clip', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				episodeId: menu.episodeId,
				positionSec: video.currentTime,
				minutes,
				// The audio heard, which may not be the one in Ajustes.
				language: menu.audioTracks[menu.audioIndex()]?.lang ?? null
			})
		}).catch(() => null);
		const body = await res?.json().catch(() => null);
		languaState = body?.message ?? 'No se pudo mandar.';
	}

	let thumbnailState = $state<'idle' | 'saving' | 'done' | 'failed'>('idle');

	/** The frame on screen becomes the episode's thumbnail; taken by the server from the video. */
	async function useAsThumbnail() {
		const video = menu.video();
		if (!video) return;
		thumbnailState = 'saving';
		const res = await fetch(`/api/thumb/${menu.episodeId}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ atSec: video.currentTime })
		}).catch(() => null);
		thumbnailState = res?.ok ? 'done' : 'failed';
		if (res?.ok) thumbChanged(menu.episodeId);
		setTimeout(() => (thumbnailState = 'idle'), 2000);
	}

	let backdropState = $state<'idle' | 'saving' | 'done' | 'failed'>('idle');

	/** The frame on screen goes behind the top of the series' page (backdrop.ts). */
	async function useAsBackdrop() {
		const video = menu.video();
		if (!video) return;
		backdropState = 'saving';
		backdropState = (await useFrameAsBackdrop(menu.episodeId, video.currentTime))
			? 'done'
			: 'failed';
		setTimeout(() => (backdropState = 'idle'), 2000);
	}
</script>

{#snippet choices(label: string, options: { label: string; pick: () => void }[])}
	<div>
		<p class="mb-1 px-2 text-xs tracking-wide text-zinc-500 uppercase">{label}</p>
		<div class="flex flex-wrap gap-1">
			{#each options as option, i (i)}
				<button class="rounded px-2 py-1 text-zinc-300 hover:bg-zinc-800" onclick={option.pick}
					>{option.label}</button
				>
			{/each}
		</div>
	</div>
{/snippet}

{#if langua}
	{@render choices(
		'Mandar a Langua',
		[1, 2, 5].map((m) => ({ label: `Últimos ${m} min`, pick: () => toLangua(m) }))
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

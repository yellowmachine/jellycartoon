<script lang="ts">
	import { HOW, installApp } from '#lib/install-app.svelte.ts';

	/** With the other browsers' steps below, folded (the landing). */
	let { others = false }: { others?: boolean } = $props();

	const mine = $derived(HOW.find((h) => h.id === installApp.browser) ?? HOW[0]);
</script>

{#if installApp.offer}
	<button
		type="button"
		onclick={() => installApp.prompt()}
		class="rounded-md bg-amber-500 px-5 py-2.5 font-medium text-zinc-950 hover:bg-amber-400"
	>
		Instalar Seilide
	</button>
{:else}
	<p class="text-sm">
		<span class="text-zinc-500">{mine.name}:</span>
		{#if mine.id === 'ios'}
			<!-- Safari's share button, as it looks, so it is found at a glance. -->
			<svg
				viewBox="0 0 24 24"
				aria-hidden="true"
				class="inline h-5 w-5 align-text-bottom text-sky-400"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path
					d="M8 9H6.5A1.5 1.5 0 0 0 5 10.5v9A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 17.5 9H16"
				/>
				<path d="M12 3v11M8.5 6.5 12 3l3.5 3.5" />
			</svg>
		{/if}
		{mine.steps}
	</p>
{/if}

{#if others}
	<details class="mt-4 text-sm">
		<summary class="cursor-pointer text-zinc-400 hover:text-zinc-100">Otros navegadores</summary>
		<dl class="mt-3 flex flex-col gap-2">
			{#each HOW.filter((h) => installApp.offer || h.id !== mine.id) as h (h.id)}
				<div>
					<dt class="font-medium text-zinc-200">{h.name}</dt>
					<dd class="text-zinc-400">{h.steps}</dd>
				</div>
			{/each}
		</dl>
	</details>
{/if}

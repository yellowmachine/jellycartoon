<script lang="ts">
	import { page } from '$app/state';
	import MusicBackground from 'comun/components/MusicBackground.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const onLists = $derived(page.url.pathname.startsWith('/musica/listas'));
	const tab = (selected: boolean) => [
		'border-b-2 px-1 pb-2 text-sm',
		selected ? 'border-amber-500 text-white' : 'border-transparent text-zinc-400 hover:text-white'
	];
</script>

<!-- As jellycartoon's (#253): without its speakers here, only this device. -->
<MusicBackground snapcast={false} />

<!-- Tabs that are links: each view has its own address, and «back» works. -->
<nav class="mb-6 flex gap-6 border-b border-zinc-800">
	<a href="/musica" class={tab(!onLists)} aria-current={!onLists ? 'page' : undefined}>Álbumes</a>
	<a href="/musica/listas" class={tab(onLists)} aria-current={onLists ? 'page' : undefined}
		>Listas</a
	>
</nav>

{#if data.houseProblem || data.passProblem}
	<p class="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
		La música es la de casa: {data.houseProblem ?? data.passProblem}
	</p>
{/if}

{@render children()}

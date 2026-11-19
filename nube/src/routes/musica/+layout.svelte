<script lang="ts">
	import { page } from '$app/state';
	import MusicBackground from 'comun/components/MusicBackground.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	/**
	 * The same three tabs whatever the source (#534, phase 3): the house's music, or the family's own
	 * bucket under /musica/tu-musica, as chosen in Ajustes → Para mí.
	 */
	const own = $derived(data.source === 'propia');
	const base = $derived(own ? '/musica/tu-musica' : '/musica');
	const onLists = $derived(
		page.url.pathname.startsWith('/musica/listas') ||
			page.url.pathname.startsWith('/musica/tu-musica/listas')
	);
	const onFolders = $derived(
		page.url.pathname.startsWith('/musica/carpetas') ||
			page.url.pathname.startsWith('/musica/tu-musica/carpetas')
	);
	/** What plays and comes next (it was a panel under the player). */
	const onQueue = $derived(page.url.pathname.startsWith('/musica/cola'));
	const onAlbums = $derived(!onLists && !onFolders && !onQueue);
	const tab = (selected: boolean) => [
		'border-b-2 px-1 pb-2 text-sm',
		selected ? 'border-amber-500 text-white' : 'border-transparent text-zinc-400 hover:text-white'
	];
</script>

<!-- As jellycartoon's (#253): without its speakers here, only this device. -->
<MusicBackground snapcast={false} />

<!-- Tabs that are links: each view has its own address, and «back» works. -->
<nav class="mb-6 flex gap-6 border-b border-zinc-800">
	<a href={base} class={tab(onAlbums)} aria-current={onAlbums ? 'page' : undefined}>Álbumes</a>
	<a href="/musica/listas" class={tab(onLists)} aria-current={onLists ? 'page' : undefined}
		>Listas</a
	>
	<!-- The music as it is on disk (or in the bucket), with what has no album (podcasts, talks). -->
	<a href="{base}/carpetas" class={tab(onFolders)} aria-current={onFolders ? 'page' : undefined}
		>Carpetas</a
	>
	<a href="/musica/cola" class={tab(onQueue)} aria-current={onQueue ? 'page' : undefined}>Cola</a>
</nav>

{#if !own && (data.houseProblem || data.passProblem)}
	<p class="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
		La música es la de casa: {data.houseProblem ?? data.passProblem}
	</p>
{/if}

{@render children()}

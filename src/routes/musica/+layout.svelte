<script lang="ts">
	import { page } from '$app/state';
	import MusicBackground from 'comun/components/MusicBackground.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const onLists = $derived(page.url.pathname.startsWith('/musica/listas'));
	const onFolders = $derived(page.url.pathname.startsWith('/musica/carpetas'));
	const tab = (selected: boolean) => [
		'border-b-2 px-1 pb-2 text-sm',
		selected ? 'border-amber-500 text-white' : 'border-transparent text-zinc-400 hover:text-white'
	];
</script>

<MusicBackground snapcast={Boolean(page.data.snapcast)} />

<!-- Tabs that are links: each view has its own address, and «back» works. -->
<nav class="mb-6 flex gap-6 border-b border-zinc-800">
	<a
		href="/musica"
		class={tab(!onLists && !onFolders)}
		aria-current={!onLists && !onFolders ? 'page' : undefined}>Álbumes</a
	>
	<a href="/musica/listas" class={tab(onLists)} aria-current={onLists ? 'page' : undefined}
		>Listas</a
	>
	<!-- The music as it is on disk, with what has no album (podcasts, talks). -->
	<a href="/musica/carpetas" class={tab(onFolders)} aria-current={onFolders ? 'page' : undefined}
		>Carpetas</a
	>
</nav>

{@render children()}

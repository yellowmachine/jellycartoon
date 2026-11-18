<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import MusicLibrary from '#lib/components/MusicLibrary.svelte';
	import { mixed } from 'comun/music.ts';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import { asAlbum, OWN_LISTS_API, ownArtistUrl } from '#lib/own-music.ts';
	import { vista } from '#lib/vista.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * «Tu música» (#534): the music the family keeps in its own bucket, as Álbumes shows the house's
	 * (MusicLibrary): by album or by artist, searched in the browser. Only on this device (not the
	 * house's speakers), and without Modo DJ nor playlists for now.
	 */
	let { data }: PageProps = $props();

	const albums = $derived(data.albums.map(asAlbum));

	/** «Todo aleatorio»: everything this browser plays, shuffled (the first few hundred). */
	const playAll = () => {
		const all = mixed(albums.flatMap((a) => a.tracks)).slice(0, 500);
		if (all.length) void musicTarget.play(all, 0, false);
	};

	// Reading the bucket: how far, every few seconds, until it ends.
	$effect(() => {
		if (!data.source?.scanning) return;
		const every = setInterval(() => void invalidateAll(), 3000);
		return () => clearInterval(every);
	});

	const button = 'rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900';
</script>

<svelte:head>
	<title>Tu música · Seilide</title>
</svelte:head>

{#if !data.source}
	<h1 class="mb-6 text-2xl font-bold">Tu música</h1>
	<div class="rounded-md border border-zinc-800 p-6 text-sm text-zinc-300">
		<p class="mb-2">
			Aquí sale la música que tengáis en vuestro propio almacenamiento (S3, R2, Backblaze…), sin
			subirla a ningún sitio.
		</p>
		{#if data.admin}
			<p>
				Conéctalo en <a
					href="/ajustes?seccion=conexiones#tu-musica"
					class="text-amber-400 underline">Ajustes → Conexiones → Tu música</a
				>.
			</p>
		{:else}
			<p class="text-zinc-400">Quien administra la familia lo conecta en Ajustes.</p>
		{/if}
	</div>
{:else}
	{@const source = data.source}
	<MusicLibrary
		{albums}
		artistHref={ownArtistUrl}
		playlists={vista.kiosk ? null : data.playlists}
		listEndpoint={OWN_LISTS_API}
		viewKey="nube:own-music-view"
		loading="Buscando música…"
	>
		{#snippet title()}Tu música{/snippet}
		{#snippet actions()}
			{#if albums.length}
				<button class={button} onclick={playAll}>🔀 Todo aleatorio</button>
			{/if}
			{#if data.admin}
				<a href="/musica/tu-musica/gestion" class={button}>⚙ Gestión</a>
			{/if}
		{/snippet}
		{#snippet notice()}
			{#if source.scanning}
				<p class="mb-4 text-sm text-zinc-400" role="status">
					{#if source.phase === 'portadas'}
						Buscando portadas… {source.coversDone} de {source.coversTotal}
					{:else}
						Buscando música… {source.total
							? `${source.done.toLocaleString('es-ES')} de ${source.total.toLocaleString('es-ES')}`
							: ''}
					{/if}
				</p>
			{:else if source.problem}
				<p class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
					Al leer vuestro almacenamiento: {source.problem}.
				</p>
			{/if}
		{/snippet}
		{#snippet empty()}
			{#if !source.scanning}
				<p class="text-sm text-zinc-400">
					No hay música en <span class="text-zinc-200">{source.label}</span>: mp3, m4a, flac, ogg,
					opus o wav, en esa carpeta o dentro de otras.
				</p>
			{/if}
		{/snippet}
	</MusicLibrary>
{/if}

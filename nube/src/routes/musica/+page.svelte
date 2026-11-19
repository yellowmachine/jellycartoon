<script lang="ts">
	import MediaIcon from 'comun/components/MediaIcon.svelte';
	import GuideLink from '#lib/components/GuideLink.svelte';
	import MusicLibrary from '#lib/components/MusicLibrary.svelte';
	import { vista } from '#lib/vista.svelte.ts';
	import { enhance } from '$app/forms';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import DjDialog from 'comun/components/DjDialog.svelte';
	import { artistUrl, groupByArtist, type MusicAlbum } from 'comun/music.ts';
	import type { PageProps } from './$types';

	/**
	 * Música (#253), as jellycartoon's: the house's albums, by album or by artist, searched in the
	 * browser (MusicLibrary, as Tu música's), and its Modo DJ. Without the catalog's state and
	 * «Escanear»: that is at home (Gestión); and only on this device, without the house's speakers.
	 */
	let { data }: PageProps = $props();

	/**
	 * The catalog, when it comes (+page.server.ts); null until then. After saving a Modo DJ setup
	 * the page loads again: the albums shown stay until the new ones are here.
	 */
	let catalog = $state<MusicAlbum[] | null>(null);
	let failed = $state(false);
	$effect(() => {
		let gone = false;
		data.albums.then(
			(albums) => {
				if (!gone) [catalog, failed] = [albums, false];
			},
			() => {
				if (!gone) failed = true;
			}
		);
		return () => (gone = true);
	});
	/** For Modo DJ's choice of artists. */
	const artists = $derived(groupByArtist(catalog ?? []));
	let djDialog = $state<DjDialog>();
	let djMenu = $state<HTMLElement>();

	// «Con DJ» from a playlist's page (/musica?dj=<id>&lista=<name>): the dialog with that playlist.
	let djAsked = false;
	$effect(() => {
		const id = Number(page.url.searchParams.get('dj'));
		if (djAsked || !djDialog || !Number.isInteger(id) || id <= 0) return;
		djAsked = true;
		djDialog.open(undefined, { id, name: page.url.searchParams.get('lista') || 'la lista' });
		replaceState('/musica', {});
	});
</script>

<svelte:head>
	<title>Música · Seilide</title>
</svelte:head>

<MusicLibrary
	albums={catalog}
	artistHref={artistUrl}
	playlists={data.playlists}
	viewKey="nube:music-view"
	loading="Trayendo la música de casa…"
	failed={failed ? 'No se ha podido traer la música de casa.' : null}
>
	{#snippet title()}Música<GuideLink page="musica" label="la música" />{/snippet}
	{#snippet actions()}
		{#if data.dj}
			{@const djClass = 'rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900'}
			{@const djTitle = 'Canciones al azar con un locutor entre ellas, como en la radio'}
			{#if data.djPresets.length}
				<!-- Native popover, as ActionMenu: closes with Esc or a click outside. -->
				<button
					class={djClass}
					title={djTitle}
					popovertarget="dj-menu"
					style:anchor-name="--dj-menu"
					><MediaIcon name="mic" class="mr-1.5 inline h-4 w-4 align-[-0.15em]" />Modo DJ ▾</button
				>
				<div
					bind:this={djMenu}
					id="dj-menu"
					popover="auto"
					style:position-anchor="--dj-menu"
					class="dj-menu inset-auto m-0 mt-1 w-max max-w-72 min-w-48 rounded-md border border-zinc-700 bg-zinc-900 p-1 text-sm text-zinc-100 shadow-lg"
				>
					<button
						class="w-full rounded px-3 py-1.5 text-left hover:bg-zinc-800"
						onclick={() => {
							djMenu?.hidePopover();
							djDialog?.open();
						}}>Nuevo…</button
					>
					<div class="my-1 border-t border-zinc-800"></div>
					{#each data.djPresets as preset (preset.id)}
						<div class="group flex items-center rounded hover:bg-zinc-800">
							<button
								class="min-w-0 flex-1 truncate px-3 py-1.5 text-left"
								title="Empezar"
								onclick={() => {
									djMenu?.hidePopover();
									djDialog?.startPreset(preset);
								}}>{preset.name}</button
							>
							<!-- On hover with a mouse; always there on a touch screen. Not in the locked Vista (#532). -->
							{#if !vista.kiosk}
								<div
									class="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100"
								>
									<button
										class="px-2 py-1.5 text-zinc-400 hover:text-white"
										title="Editar"
										aria-label="Editar {preset.name}"
										onclick={() => {
											djMenu?.hidePopover();
											djDialog?.open(preset);
										}}><MediaIcon name="edit" class="h-4 w-4" /></button
									>
									<form method="post" action="?/djDelete" use:enhance>
										<input type="hidden" name="id" value={preset.id} />
										<button
											class="px-2 py-1.5 text-zinc-400 hover:text-red-400"
											title="Borrar"
											aria-label="Borrar {preset.name}"
											><MediaIcon name="close" class="h-3.5 w-3.5" /></button
										>
									</form>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<button class={djClass} title={djTitle} onclick={() => djDialog?.open()}
					><MediaIcon name="mic" class="mr-1.5 inline h-4 w-4 align-[-0.15em]" />Modo DJ</button
				>
			{/if}
			<DjDialog bind:this={djDialog} {artists} voices={data.djVoices} />
		{/if}
	{/snippet}
	{#snippet empty()}
		<p class="text-zinc-400">No hay música todavía: se cataloga en casa, en Gestión.</p>
	{/snippet}
</MusicLibrary>

<style>
	/* Below the button, aligned to its right edge; above it if there is no room underneath. */
	.dj-menu {
		position-area: bottom span-left;
		position-try-fallbacks: flip-block;
	}
</style>

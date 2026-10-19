<script lang="ts">
	import { enhance } from '$app/forms';
	import AddToPlaylist from '#lib/components/AddToPlaylist.svelte';
	import AlbumCover from '#lib/components/AlbumCover.svelte';
	import MusicTargetSwitch from '#lib/components/MusicTargetSwitch.svelte';
	import TitleForm from '#lib/components/TitleForm.svelte';
	import { formatDuration } from '#lib/format.ts';
	import { artistUrl } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import { musicTarget } from '#lib/music-target.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const album = $derived(data.album);
	/** Only where Snapcast is set up; elsewhere, always this device. */
	const toSnapcast = $derived(data.snapcast && musicTarget.value === 'snapcast');
	/** What is being renamed: the album, its artist, a track id, or nothing. */
	let editing = $state<'album' | 'artist' | number | null>(null);
	const totalSec = $derived(album.tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0));
	/** Asking the AI and MusicBrainz for covers, or saving the chosen one. */
	let coverBusy = $state<'search' | 'choose' | null>(null);
	const proposals = $derived(form && 'proposals' in form ? (form.proposals ?? null) : null);
	/** Saved: the other discs of the album that got it too. */
	const alsoFor = $derived(form && 'alsoFor' in form ? (form.alsoFor ?? null) : null);
	const renamed = $derived(form && 'renamed' in form && form.renamed);
	/** The album takes the chosen edition's name too: «… CD1» of «Lauper, Cyndi» is dirty. */
	let rename = $state(true);
</script>

<svelte:head>
	<title>{album.title} · JellyCartoon</title>
</svelte:head>

{#snippet editButton(target: 'album' | 'artist' | number, label: string)}
	<button
		hidden={data.kid}
		class="shrink-0 rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
		title={label}
		aria-label={label}
		onclick={() => (editing = target)}>✎</button
	>
{/snippet}

<nav class="flex min-w-0 items-center gap-1.5 text-sm text-zinc-400">
	<a href="/musica" class="shrink-0 hover:text-white">Música</a>
	<span aria-hidden="true">›</span>
	<a href={artistUrl(album.artist)} class="truncate hover:text-white">{album.artist}</a>
</nav>

<div class="mt-3 mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
	<AlbumCover {album} class="w-48 shrink-0 rounded-md" />
	<div class="min-w-0">
		{#if editing === 'album'}
			<div class="flex">
				<TitleForm
					action="?/renameAlbum"
					value={album.title}
					placeholder={data.tagTitles.album}
					onclose={() => (editing = null)}
				/>
			</div>
		{:else}
			<h1 class="flex items-center gap-2 text-2xl font-bold">
				{album.title}
				{@render editButton('album', 'Cambiar título del álbum')}
			</h1>
		{/if}
		{#if editing === 'artist'}
			<div class="flex">
				<TitleForm
					action="?/renameArtist"
					value={album.artist}
					placeholder={data.tagTitles.artist}
					label="Artista"
					onclose={() => (editing = null)}
				/>
			</div>
		{:else}
			<p class="flex items-center gap-1">
				<a href={artistUrl(album.artist)} class="text-zinc-300 hover:text-white hover:underline"
					>{album.artist}</a
				>
				{@render editButton('artist', 'Cambiar el artista del álbum')}
			</p>
		{/if}
		<p class="mb-3 text-sm text-zinc-400">
			{album.tracks.length} canciones · {formatDuration(totalSec)}
		</p>
		<div class="flex flex-wrap gap-2">
			<button
				class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400"
				onclick={() => musicTarget.play(album.tracks, 0, toSnapcast)}>▶︎ Reproducir</button
			>
			<button
				class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
				onclick={() => musicTarget.append(album.tracks, toSnapcast)}>+ Añadir a la cola</button
			>
		</div>
	</div>
</div>

{#if !data.kid && (!album.hasCover || form)}
	<section class="mb-6">
		{#if form && 'message' in form}
			<p class="mb-2 text-sm text-red-300">{form.message}</p>
		{/if}
		{#if alsoFor}
			<p class="text-sm text-emerald-300">
				{renamed ? 'Carátula y nombre puestos' : 'Carátula puesta'}{alsoFor.length
					? `, también en ${alsoFor.join(', ')}`
					: ''}.
			</p>
		{:else if proposals}
			{#if proposals.length}
				<p class="mb-2 text-sm text-zinc-400">Elige la carátula:</p>
				<label class="mb-3 flex items-center gap-2 text-sm text-zinc-300">
					<input type="checkbox" bind:checked={rename} class="accent-amber-500" />
					Poner también su nombre (se conserva el número de disco)
				</label>
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
					{#each proposals as p (p.releaseGroupId)}
						<form
							method="post"
							action="?/chooseCover"
							use:enhance={() => {
								coverBusy = 'choose';
								return async ({ update }) => {
									await update();
									coverBusy = null;
								};
							}}
						>
							<input type="hidden" name="releaseGroupId" value={p.releaseGroupId} />
							{#if rename}
								<input type="hidden" name="rename" value="1" />
								<input type="hidden" name="title" value={p.title} />
								<input type="hidden" name="artist" value={p.artist} />
							{/if}
							<button
								class="w-full rounded-md p-1 text-left hover:bg-zinc-900 disabled:opacity-50"
								disabled={coverBusy !== null}
							>
								<img
									src={p.thumbUrl}
									alt=""
									class="aspect-square w-full rounded bg-zinc-800 object-cover"
								/>
								<span class="mt-1 block truncate text-sm">{p.title}</span>
								<span class="block truncate text-xs text-zinc-400"
									>{[p.artist, p.year].filter(Boolean).join(' · ')}</span
								>
							</button>
						</form>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-zinc-400">No he encontrado carátulas para este álbum.</p>
			{/if}
		{:else if !album.hasCover}
			<form
				method="post"
				action="?/proposeCovers"
				use:enhance={() => {
					coverBusy = 'search';
					return async ({ update }) => {
						// The proposals stay: nothing on the page changed.
						await update({ invalidateAll: false });
						coverBusy = null;
					};
				}}
			>
				<button
					class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900 disabled:opacity-50"
					disabled={coverBusy !== null}
					>{coverBusy === 'search' ? 'Buscando carátulas…' : 'Buscar carátula'}</button
				>
			</form>
		{/if}
	</section>
{/if}

{#if data.snapcast}
	<div class="mb-4"><MusicTargetSwitch /></div>
{/if}

<ol class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
	{#each album.tracks as t, i (t.id)}
		<li class="flex items-center pr-1">
			{#if editing === t.id}
				<div class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
					<span class="w-6 shrink-0 text-right font-mono text-xs text-zinc-500 tabular-nums"
						>{t.number ?? i + 1}</span
					>
					<TitleForm
						action="?/renameTrack"
						value={t.title}
						placeholder={data.tagTitles.tracks[t.id]}
						hidden={{ id: t.id }}
						onclose={() => (editing = null)}
					/>
				</div>
			{:else}
				<button
					class={[
						'flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-zinc-900',
						music.current?.id === t.id && 'text-amber-400'
					]}
					onclick={() => musicTarget.play(album.tracks, i, toSnapcast)}
				>
					<span class="w-6 shrink-0 text-right font-mono text-xs text-zinc-500 tabular-nums">
						{music.current?.id === t.id && music.playing ? '♪' : (t.number ?? i + 1)}
					</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm">{t.title}</span>
						{#if t.artist !== album.artist}
							<span class="block truncate text-xs text-zinc-400">{t.artist}</span>
						{/if}
					</span>
					<span class="text-xs text-zinc-500">{formatDuration(t.durationSec)}</span>
				</button>
				{@render editButton(t.id, 'Cambiar título de la canción')}
			{/if}
			<AddToPlaylist trackId={t.id} key="album-{t.id}" playlists={data.playlists} />
		</li>
	{/each}
</ol>

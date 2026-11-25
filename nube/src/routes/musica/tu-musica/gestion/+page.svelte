<script lang="ts">
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { ownAlbumUrl } from '#lib/own-music.ts';
	import type { PageProps } from './$types';

	/**
	 * Gestión of «Tu música» (#534): what is going on with the bucket now (reading its files,
	 * looking covers up), how the last reading went, what could not be read and the albums still
	 * without a cover. Every few seconds while it works.
	 */
	let { data }: PageProps = $props();

	const m = $derived(data.management);
	const s = $derived(m?.source);
	let busy = $state(false);
	const when = (d: Date) =>
		d.toLocaleString('es-ES', {
			day: 'numeric',
			month: 'long',
			hour: '2-digit',
			minute: '2-digit'
		});
	const share = (done: number, total: number) => (total ? (done / total) * 100 : 0);

	$effect(() => {
		if (!s?.scanning) return;
		const every = setInterval(() => void refreshAll(), 3000);
		return () => clearInterval(every);
	});

	const submit = () => {
		busy = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			busy = false;
		};
	};
</script>

<svelte:head>
	<title>Gestión de Tu música · Seilide</title>
</svelte:head>

<nav class="mb-4 flex items-center gap-1.5 text-sm text-zinc-400">
	<a href="/musica/tu-musica" class="hover:text-white">Música</a>
	<span aria-hidden="true">›</span>
	<span>Gestión</span>
</nav>

{#if !m || !s}
	<p class="text-sm text-zinc-400">
		No hay almacenamiento conectado. Se conecta en <a
			href="/ajustes?seccion=conexiones#tu-musica"
			class="text-amber-400 underline">Ajustes → Conexiones → Tu música</a
		>.
	</p>
{:else}
	<section class="mb-6 rounded-md border border-zinc-800 p-4">
		<h2 class="mb-1 font-semibold">Ahora</h2>
		<p class="mb-3 text-sm text-zinc-400">En <span class="text-zinc-200">{s.label}</span></p>
		{#if s.scanning && s.phase === 'portadas'}
			<p class="mb-2 text-sm" role="status">
				Buscando portadas en MusicBrainz: {s.coversDone} de {s.coversTotal}
			</p>
			<div class="mb-2 h-2 overflow-hidden rounded-full bg-zinc-800">
				<div
					class="h-full rounded-full bg-sky-500"
					style="width: {share(s.coversDone, s.coversTotal)}%"
				></div>
			</div>
			<p class="text-xs text-zinc-500">Una por segundo, como pide MusicBrainz.</p>
		{:else if s.scanning}
			<p class="mb-2 text-sm" role="status">
				Leyendo canciones nuevas o cambiadas: {s.done} de {s.total}
			</p>
			<div class="h-2 overflow-hidden rounded-full bg-zinc-800">
				<div class="h-full rounded-full bg-sky-500" style="width: {share(s.done, s.total)}%"></div>
			</div>
		{:else}
			<p class="text-sm text-zinc-300">
				Nada en marcha. {s.indexedAt ? `Última lectura: ${when(s.indexedAt)}.` : ''} Se vuelve a mirar
				cada noche.
			</p>
		{/if}
		<div class="mt-4 flex flex-wrap gap-2">
			<form method="post" action="?/index" use:enhance={submit}>
				<button
					class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
					disabled={busy || s.scanning}>Volver a buscar</button
				>
			</form>
			{#if m.withoutCover.some((a) => !a.pending)}
				<form method="post" action="?/covers" use:enhance={submit}>
					<button
						class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
						disabled={busy || s.scanning}>Buscar portadas otra vez</button
					>
				</form>
			{/if}
		</div>
	</section>

	<section class="mb-6 rounded-md border border-zinc-800 p-4">
		<h2 class="mb-3 font-semibold">La música</h2>
		<dl class="grid grid-cols-2 gap-y-1 text-sm sm:grid-cols-4">
			<dt class="text-zinc-400">Canciones</dt>
			<dd class="tabular-nums">{s.tracks.toLocaleString('es-ES')}</dd>
			<dt class="text-zinc-400">Discos</dt>
			<dd class="tabular-nums">{m.albums.toLocaleString('es-ES')}</dd>
		</dl>
	</section>

	<section class="mb-6 rounded-md border border-zinc-800 p-4">
		<h2 class="mb-3 font-semibold">Portadas</h2>
		<ul class="mb-3 space-y-1 text-sm">
			<li class="flex justify-between gap-3">
				<span class="text-zinc-400">Imagen en su carpeta</span>
				<span class="tabular-nums">{m.covers.carpeta}</span>
			</li>
			<li class="flex justify-between gap-3">
				<span class="text-zinc-400">Dentro de sus canciones</span>
				<span class="tabular-nums">{m.covers.cancion}</span>
			</li>
			<li class="flex justify-between gap-3">
				<span class="text-zinc-400">De MusicBrainz</span>
				<span class="tabular-nums">{m.covers.musicbrainz}</span>
			</li>
			<li class="flex justify-between gap-3">
				<span class="text-zinc-400">Sin portada</span>
				<span class="tabular-nums">{m.withoutCover.length}</span>
			</li>
		</ul>
		{#if !m.storage}
			<p class="mb-3 text-sm text-amber-400">
				Este Seilide no tiene almacenamiento de ficheros: no se buscan portadas en MusicBrainz.
			</p>
		{/if}
		{#if m.withoutCover.length}
			<details>
				<summary class="cursor-pointer text-sm text-zinc-300">Discos sin portada</summary>
				<ul class="mt-2 space-y-1 text-sm">
					{#each m.withoutCover as a (a.id)}
						<li class="flex justify-between gap-3">
							<a href={ownAlbumUrl(a.id)} class="min-w-0 truncate hover:underline"
								>{a.artist} — {a.title}</a
							>
							<span class="shrink-0 text-xs text-zinc-500"
								>{a.pending
									? 'por buscar'
									: a.artist === 'Desconocido'
										? 'sin artista: no se busca'
										: 'no está en MusicBrainz'}</span
							>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</section>

	<section class="mb-6 rounded-md border border-zinc-800 p-4">
		<h2 class="mb-3 font-semibold">Ficheros que no se pudieron leer</h2>
		{#if m.failures.length}
			<ul class="space-y-2 text-sm">
				{#each m.failures as f (f.key)}
					<li>
						<span class="block break-all text-zinc-200">{f.key}</span>
						<span class="block text-xs text-zinc-500">{f.error}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-zinc-400">Ninguno en la última lectura.</p>
		{/if}
	</section>
{/if}

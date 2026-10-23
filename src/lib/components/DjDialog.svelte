<script lang="ts">
	import { dj } from '#lib/dj.svelte.ts';
	import { DJ_EVERY, fold, type DjOptions, type MusicArtist } from '#lib/music.ts';
	import { musicTarget } from '#lib/music-target.svelte.ts';

	/**
	 * Modo DJ (#117): which artists (none, the whole library), the DJ's language and how often it
	 * speaks; then it starts where the music sounds (this browser or Snapcast).
	 */
	let { artists }: { artists: MusicArtist[] } = $props();

	let dialog = $state<HTMLDialogElement>();
	let chosen = $state<string[]>([]);
	let lang = $state<DjOptions['lang']>('es');
	let every = $state(DJ_EVERY.default);
	let filter = $state('');
	let starting = $state(false);
	let problem = $state<string | null>(null);

	const shown = $derived(
		filter ? artists.filter((a) => fold(a.name).includes(fold(filter))) : artists
	);

	export function open() {
		const last = dj.remembered();
		if (last) {
			// Only artists that are still there.
			const names = new Set(artists.map((a) => a.name));
			chosen = last.artists.filter((a) => names.has(a));
			lang = last.lang;
			every = last.every;
		}
		problem = null;
		dialog?.showModal();
	}

	async function start() {
		const options: DjOptions = { artists: chosen, lang, every };
		starting = true;
		problem = null;
		try {
			if (musicTarget.value === 'snapcast') {
				const res = await fetch('/api/music/dj/snapcast', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(options)
				});
				if (!res.ok)
					throw new Error((await res.json().catch(() => null))?.message ?? res.statusText);
			} else await dj.start(options);
			dj.remember(options);
			dialog?.close();
		} catch (err) {
			problem = err instanceof Error ? err.message : String(err);
		} finally {
			starting = false;
		}
	}
</script>

<dialog
	bind:this={dialog}
	closedby="any"
	class="m-auto w-lg max-w-[calc(100vw-2rem)] rounded-md border border-zinc-700 bg-zinc-900 p-5 text-sm text-zinc-100 shadow-lg backdrop:bg-zinc-950/70"
>
	<h2 class="mb-1 font-semibold">Modo DJ</h2>
	<p class="mb-4 text-zinc-400">
		Canciones al azar y, cada pocas, un locutor que dice qué ha sonado y qué viene, como en la
		radio. Suena {musicTarget.value === 'snapcast' ? 'en Snapcast' : 'en este dispositivo'}.
	</p>

	<h3 class="mb-1 text-zinc-300">
		Artistas <span class="text-zinc-500"
			>· {chosen.length ? `${chosen.length} elegidos` : 'ninguno: toda la música'}</span
		>
	</h3>
	<input
		type="search"
		bind:value={filter}
		placeholder="Buscar artista"
		aria-label="Buscar artista"
		class="mb-2 w-full rounded-md border-zinc-700 bg-zinc-950 py-1 text-sm"
	/>
	<div class="mb-4 max-h-48 overflow-y-auto rounded-md border border-zinc-800 p-1">
		{#each shown as artist (artist.name)}
			<label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-zinc-800">
				<input
					type="checkbox"
					class="rounded border-zinc-600 bg-zinc-900 text-amber-500"
					checked={chosen.includes(artist.name)}
					onchange={(e) =>
						(chosen = e.currentTarget.checked
							? [...chosen, artist.name]
							: chosen.filter((a) => a !== artist.name))}
				/>
				<span class="truncate">{artist.name}</span>
			</label>
		{:else}
			<p class="px-2 py-1 text-zinc-500">Ningún artista con «{filter}».</p>
		{/each}
	</div>

	<div class="mb-4 flex flex-wrap items-center gap-4">
		<label class="flex items-center gap-2">
			Locutor en
			<select bind:value={lang} class="rounded-md border-zinc-700 bg-zinc-950 py-1 text-sm">
				<option value="es">español</option>
				<option value="en">inglés</option>
			</select>
		</label>
		<label class="flex items-center gap-2">
			Habla cada
			<select bind:value={every} class="rounded-md border-zinc-700 bg-zinc-950 py-1 text-sm">
				{#each { length: DJ_EVERY.max - DJ_EVERY.min + 1 }, i (i)}
					<option value={DJ_EVERY.min + i}>{DJ_EVERY.min + i}</option>
				{/each}
			</select>
			{every === 1 ? 'canción' : 'canciones'}
		</label>
	</div>

	{#if problem}
		<p class="mb-3 text-red-400">{problem}</p>
	{/if}
	<div class="flex justify-end gap-2">
		<button
			type="button"
			class="rounded-md px-3 py-1.5 text-zinc-400 hover:text-white"
			onclick={() => dialog?.close()}>Cancelar</button
		>
		<button
			type="button"
			disabled={starting}
			class="rounded-md bg-amber-500 px-4 py-1.5 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
			onclick={start}>{starting ? 'Empezando…' : 'Empezar'}</button
		>
	</div>
</dialog>

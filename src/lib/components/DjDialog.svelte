<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { dj } from 'comun/dj.svelte.ts';
	import {
		DJ_DEFAULT_VOICE,
		DJ_EVERY,
		fold,
		type DjOptions,
		type DjPreset,
		type MusicArtist
	} from 'comun/music.ts';
	import { musicTarget } from 'comun/music-target.svelte.ts';

	/**
	 * Modo DJ (#117): which artists (none, the whole library), the DJ's language and how often it
	 * speaks; then it starts where the music sounds (this browser or Snapcast). A setup can be
	 * saved with a name, to start it again from the menu.
	 */
	let { artists, voices }: { artists: MusicArtist[]; voices: boolean } = $props();

	let dialog = $state<HTMLDialogElement>();
	let chosen = $state<string[]>([]);
	let lang = $state<DjOptions['lang']>('es');
	let every = $state(DJ_EVERY.default);
	let voice = $state(DJ_DEFAULT_VOICE);
	let filter = $state('');
	let starting = $state(false);
	let problem = $state<string | null>(null);
	/** The saved setup being edited; null, a new one. */
	let presetId = $state<number | null>(null);
	let name = $state('');
	let saving = $state(false);
	/** As last saved, to show it is so until something changes. */
	let savedAs = $state<string | null>(null);

	const options = $derived<DjOptions>({ artists: chosen, lang, every, voice });
	const saved = $derived(savedAs === JSON.stringify({ name: name.trim(), options }));

	const shown = $derived(
		filter ? artists.filter((a) => fold(a.name).includes(fold(filter))) : artists
	);

	/** Only artists that are still there. */
	function existing(names: string[]) {
		const there = new Set(artists.map((a) => a.name));
		return names.filter((a) => there.has(a));
	}

	/** A saved setup to edit, or a new one starting from the last one used here. */
	export function open(preset?: DjPreset) {
		const from = preset?.options ?? dj.remembered();
		if (from) {
			chosen = existing(from.artists);
			lang = from.lang;
			every = from.every;
			// Saved before there was a choice.
			voice = from.voice ?? DJ_DEFAULT_VOICE;
		}
		presetId = preset?.id ?? null;
		name = preset?.name ?? '';
		filter = '';
		problem = null;
		savedAs = preset ? JSON.stringify({ name, options: $state.snapshot(options) }) : null;
		dialog?.showModal();
	}

	/** Straight from the menu; if it cannot, the dialog says why. */
	export async function startPreset(preset: DjPreset) {
		try {
			await dj.play({
				...preset.options,
				artists: existing(preset.options.artists),
				// Saved before there was a choice.
				voice: preset.options.voice ?? DJ_DEFAULT_VOICE
			});
		} catch (err) {
			open(preset);
			problem = err instanceof Error ? err.message : String(err);
		}
	}

	async function start() {
		starting = true;
		problem = null;
		try {
			await dj.play($state.snapshot(options));
			dialog?.close();
		} catch (err) {
			problem = err instanceof Error ? err.message : String(err);
		} finally {
			starting = false;
		}
	}

	const save: SubmitFunction = () => {
		saving = true;
		problem = null;
		const sent = JSON.stringify({ name: name.trim(), options: $state.snapshot(options) });
		return async ({ result, update }) => {
			saving = false;
			if (result.type === 'success') {
				presetId = Number(result.data?.saved);
				savedAs = sent;
				// The menu's list again, without touching this dialog.
				await update({ reset: false });
			} else if (result.type === 'failure')
				problem = String(result.data?.message ?? 'No se ha podido guardar');
			else problem = 'No se ha podido guardar';
		};
	};
</script>

<dialog
	bind:this={dialog}
	closedby="any"
	class="m-auto w-lg max-w-[calc(100vw-2rem)] rounded-md border border-zinc-700 bg-zinc-900 p-5 text-sm text-zinc-100 shadow-lg backdrop:bg-zinc-950/70"
>
	<h2 class="mb-1 font-semibold">Modo DJ{presetId !== null ? ` · ${name}` : ''}</h2>
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
		<!-- Only OpenRouter's voice has both; Piper speaks with its own. -->
		{#if voices}
			<label class="flex items-center gap-2">
				Voz de
				<select bind:value={voice} class="rounded-md border-zinc-700 bg-zinc-950 py-1 text-sm">
					<option value="male">hombre</option>
					<option value="female">mujer</option>
				</select>
			</label>
		{/if}
	</div>

	<form
		method="post"
		action="/musica?/djSave"
		use:enhance={save}
		class="mb-4 flex items-center gap-2"
	>
		{#if presetId !== null}<input type="hidden" name="id" value={presetId} />{/if}
		<input type="hidden" name="options" value={JSON.stringify(options)} />
		<input
			name="name"
			bind:value={name}
			maxlength="60"
			placeholder="Nombre, para usarla otra vez"
			aria-label="Nombre de la configuración"
			class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-950 py-1 text-sm"
		/>
		<button
			disabled={saving || !name.trim()}
			class="rounded-md border border-zinc-700 px-3 py-1 hover:bg-zinc-800 disabled:opacity-50"
			>{saving ? 'Guardando…' : saved ? 'Guardada ✓' : 'Guardar'}</button
		>
	</form>

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

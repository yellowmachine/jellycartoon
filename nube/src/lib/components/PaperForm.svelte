<script module lang="ts">
	import { goto, refreshAll } from '$app/navigation';
	import type { ActionResult } from '$app/forms';
	import { smallerPhoto } from 'comun/receipt-photo.ts';
	import type { PaperCategory } from 'comun/papers.ts';

	/** A paper being written: new (`id` null) or corrected. */
	export interface PaperDraft {
		id: number | null;
		name: string;
		category: PaperCategory;
		notes: string;
	}

	/**
	 * More kept than a receipt's, as it is read later, and by a person. A picture the browser
	 * cannot draw, as it is, for the server to refuse it with its reason.
	 */
	export async function asPaperFile(file: File) {
		if (file.type === 'application/pdf') return file;
		const photo = await smallerPhoto(file, { longest: 3000, quality: 0.9 });
		return photo instanceof File ? photo : new File([photo], 'papel.jpg', { type: photo.type });
	}

	/**
	 * After an action of Papeles, wherever it was sent from: the page's data read again, staying on
	 * this page. `update()` would land on Papeles, as a form sent to another page does.
	 */
	export async function afterPaperAction(result: ActionResult) {
		if (result.type === 'redirect') await goto(result.location);
		else if (result.type === 'success') await refreshAll();
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { MAX_PAPER_NAME, MAX_PAPER_NOTES, PAPER_CATEGORIES } from 'comun/papers.ts';

	/**
	 * The form of a paper (#384), in Papeles and in an event of the agenda (#399), which sends it to
	 * Papeles' own action. A new key for each one.
	 */
	let {
		action,
		draft,
		eventId = null,
		file = null,
		onclose
	}: {
		action: string;
		draft: PaperDraft;
		/** New, it belongs to this event of the agenda. */
		eventId?: number | null;
		/** The photo or file it was opened with, when it is ready. */
		file?: File | null;
		onclose: () => void;
	} = $props();

	const start = untrack(() => draft);
	let name = $state(start.name);
	let category = $state(start.category);
	let notes = $state(start.notes);
	let problem = $state<string | null>(null);
	let sending = $state(false);
	let fileInput = $state<HTMLInputElement>();
	let hasFile = $state(false);

	$effect(() => {
		if (!file || !fileInput) return;
		const picked = new DataTransfer();
		picked.items.add(file);
		fileInput.files = picked.files;
		hasFile = true;
	});

	const field =
		'rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500';
	const button = 'rounded-md px-3 py-1.5 text-sm disabled:opacity-40';
</script>

<form
	method="post"
	{action}
	enctype="multipart/form-data"
	class="flex flex-col gap-3 rounded-lg bg-zinc-900 p-3"
	use:enhance={() => {
		sending = true;
		problem = null;
		return async ({ result }) => {
			sending = false;
			if (result.type === 'failure') problem = String(result.data?.message ?? 'No se pudo guardar');
			else if (result.type === 'error') problem = 'No se pudo guardar';
			await afterPaperAction(result);
			if (result.type === 'success') onclose();
		};
	}}
>
	{#if start.id}<input type="hidden" name="id" value={start.id} />{/if}
	{#if eventId}<input type="hidden" name="event" value={eventId} />{/if}
	<div class="flex flex-wrap gap-3">
		<label class="flex min-w-48 flex-1 flex-col gap-1 text-xs text-zinc-400">
			Nombre
			<input
				name="name"
				bind:value={name}
				maxlength={MAX_PAPER_NAME}
				required
				class={field}
				placeholder="Contrato de alquiler"
			/>
		</label>
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Categoría
			<select name="category" bind:value={category} class={field}>
				{#each PAPER_CATEGORIES as c (c)}
					<option value={c}>{c}</option>
				{/each}
			</select>
		</label>
	</div>
	<label class="flex flex-col gap-1 text-xs text-zinc-400">
		Anotaciones
		<textarea
			name="notes"
			bind:value={notes}
			maxlength={MAX_PAPER_NOTES}
			rows="4"
			class={field}
			placeholder="Lo que quieras recordar: la fianza, cuándo se renueva, con quién hablar…"
		></textarea>
	</label>
	<label class="flex flex-col gap-1 text-xs text-zinc-400">
		{start.id ? 'Otro fichero (si quieres cambiarlo)' : 'Fichero (PDF o foto, hasta 10 MB)'}
		<input
			bind:this={fileInput}
			name="fichero"
			type="file"
			accept="application/pdf,image/jpeg,image/png,image/webp"
			required={!start.id}
			class="text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-100"
			onchange={(e) => (hasFile = Boolean(e.currentTarget.files?.length))}
		/>
	</label>
	<div class="flex gap-2">
		<button
			class="{button} bg-amber-500 font-medium text-zinc-950 hover:bg-amber-400"
			disabled={sending || (!start.id && !hasFile)}
		>
			{sending ? 'Guardando…' : 'Guardar'}
		</button>
		<button type="button" class="{button} text-zinc-400 hover:bg-zinc-800" onclick={onclose}
			>Cancelar</button
		>
	</div>
	{#if problem}<p class="text-sm text-red-400">{problem}</p>{/if}
</form>

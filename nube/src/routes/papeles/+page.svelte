<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { smallerPhoto } from 'comun/receipt-photo.ts';
	import {
		MAX_PAPER_NAME,
		MAX_PAPER_NOTES,
		PAPER_CATEGORIES,
		type Paper,
		type PaperCategory
	} from 'comun/papers.ts';
	import type { PageProps } from './$types';

	/**
	 * Papeles (#384): the family's important documents, a rent contract, an insurance policy, from
	 * a photo or a file, each with its free notes. Sealed on the server; never read by the AI.
	 */
	let { data }: PageProps = $props();

	/** The one being written: new (`id` null) or corrected. */
	interface Draft {
		id: number | null;
		name: string;
		category: PaperCategory;
		notes: string;
	}
	let draft = $state<Draft | null>(null);
	let problem = $state<string | null>(null);
	let sending = $state(false);
	let search = $state('');
	/** The one asked «¿Borrar?» about. */
	let deleting = $state<number | null>(null);
	/** The form's own file input: what it sends with the paper. */
	let fileInput = $state<HTMLInputElement>();
	let hasFile = $state(false);

	const found = $derived.by(() => {
		const words = search.trim().toLocaleLowerCase('es');
		if (!words) return data.papers;
		return data.papers.filter((p) =>
			[p.name, p.notes, p.category].some((text) => text?.toLocaleLowerCase('es').includes(words))
		);
	});

	function newOne() {
		problem = null;
		hasFile = false;
		draft = { id: null, name: '', category: 'Casa', notes: '' };
	}

	function edit(p: Paper) {
		problem = null;
		hasFile = false;
		draft = { id: p.id, name: p.name ?? '', category: p.category, notes: p.notes ?? '' };
	}

	/**
	 * More kept than a receipt's, as it is read later, and by a person. A picture the browser
	 * cannot draw, as it is, for the server to refuse it with its reason.
	 */
	async function asPaperFile(file: File) {
		if (file.type === 'application/pdf') return file;
		const photo = await smallerPhoto(file, { longest: 3000, quality: 0.9 });
		return photo instanceof File ? photo : new File([photo], 'papel.jpg', { type: photo.type });
	}

	/** A new one from a photo or a file: the form open with it, to give it a name. */
	async function fromFile(input: HTMLInputElement) {
		const original = input.files?.[0];
		// The same file can be chosen again after cancelling.
		input.value = '';
		if (!original) return;
		newOne();
		const file = await asPaperFile(original);
		await tick();
		const picked = new DataTransfer();
		picked.items.add(file);
		if (fileInput) fileInput.files = picked.files;
		hasFile = true;
	}

	const field =
		'rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500';
	const button = 'rounded-md px-3 py-1.5 text-sm disabled:opacity-40';
</script>

<svelte:head>
	<title>Papeles · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-3 text-2xl font-bold">Papeles</h1>
	<p class="mb-4 text-sm text-zinc-400">
		Los documentos importantes de la casa: el contrato de alquiler, un seguro… Para los adultos de
		la familia. Se guardan cifrados, con sus anotaciones, y la IA no los lee.
	</p>

	{#if !data.ready}
		<p class="rounded-md border border-amber-700/60 bg-amber-950/40 p-3 text-sm text-amber-200">
			Papeles no está disponible en este servidor: necesita el cifrado con KMS y donde guardar los
			ficheros.
		</p>
	{:else}
		{#if draft}
			<form
				method="post"
				action="?/save"
				enctype="multipart/form-data"
				class="mb-6 flex flex-col gap-3 rounded-lg bg-zinc-900 p-3"
				use:enhance={() => {
					sending = true;
					problem = null;
					return async ({ result, update }) => {
						sending = false;
						if (result.type === 'failure')
							problem = String(result.data?.message ?? 'No se pudo guardar');
						else if (result.type === 'error') problem = 'No se pudo guardar';
						await update({ reset: false });
						if (result.type === 'success') draft = null;
					};
				}}
			>
				{#if draft.id}<input type="hidden" name="id" value={draft.id} />{/if}
				<div class="flex flex-wrap gap-3">
					<label class="flex min-w-48 flex-1 flex-col gap-1 text-xs text-zinc-400">
						Nombre
						<input
							name="name"
							bind:value={draft.name}
							maxlength={MAX_PAPER_NAME}
							required
							class={field}
							placeholder="Contrato de alquiler"
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs text-zinc-400">
						Categoría
						<select name="category" bind:value={draft.category} class={field}>
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
						bind:value={draft.notes}
						maxlength={MAX_PAPER_NOTES}
						rows="4"
						class={field}
						placeholder="Lo que quieras recordar: la fianza, cuándo se renueva, con quién hablar…"
					></textarea>
				</label>
				<label class="flex flex-col gap-1 text-xs text-zinc-400">
					{draft.id ? 'Otro fichero (si quieres cambiarlo)' : 'Fichero (PDF o foto, hasta 10 MB)'}
					<input
						bind:this={fileInput}
						name="fichero"
						type="file"
						accept="application/pdf,image/jpeg,image/png,image/webp"
						required={!draft.id}
						class="text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-100"
						onchange={(e) => (hasFile = Boolean(e.currentTarget.files?.length))}
					/>
				</label>
				<div class="flex gap-2">
					<button
						class="{button} bg-amber-500 font-medium text-zinc-950 hover:bg-amber-400"
						disabled={sending || (!draft.id && !hasFile)}
					>
						{sending ? 'Guardando…' : 'Guardar'}
					</button>
					<button
						type="button"
						class="{button} text-zinc-400 hover:bg-zinc-800"
						onclick={() => (draft = null)}>Cancelar</button
					>
				</div>
				{#if problem}<p class="text-sm text-red-400">{problem}</p>{/if}
			</form>
		{:else}
			<div class="mb-6 flex flex-wrap gap-2">
				<label
					class="{button} cursor-pointer bg-amber-500 font-medium text-zinc-950 hover:bg-amber-400"
				>
					📷 Desde una foto
					<input
						type="file"
						accept="image/*"
						capture="environment"
						class="hidden"
						onchange={(e) => fromFile(e.currentTarget)}
					/>
				</label>
				<label class="{button} cursor-pointer bg-zinc-800 hover:bg-zinc-700">
					📄 Desde un archivo
					<input
						type="file"
						accept="application/pdf,image/jpeg,image/png,image/webp"
						class="hidden"
						onchange={(e) => fromFile(e.currentTarget)}
					/>
				</label>
			</div>
		{/if}

		{#if data.papers.length > 3}
			<input
				type="search"
				bind:value={search}
				class="{field} mb-3 w-full"
				placeholder="Buscar por nombre, anotaciones o categoría"
				aria-label="Buscar en los papeles"
			/>
		{/if}

		<ul class="mb-10 divide-y divide-zinc-800">
			{#each found as p (p.id)}
				<li class="py-3">
					{#if p.name === null}
						<p class="text-sm text-amber-200">
							Este papel no se puede leer ahora. Prueba en un rato.
						</p>
					{:else}
						<div class="flex items-start gap-2">
							<div class="min-w-0 flex-1">
								<a
									href="/papeles/{p.id}/fichero"
									target="_blank"
									rel="noreferrer"
									class="font-medium break-words text-amber-400 hover:underline"
									>{p.file === 'pdf' ? '📄' : '🖼️'} {p.name}</a
								>
								<p class="text-xs text-zinc-500">
									{p.category}{#if p.by}
										· {p.by}{/if}
								</p>
							</div>
							<button
								class="{button} shrink-0 px-2 text-zinc-400 hover:bg-zinc-800"
								aria-label="Cambiar {p.name}"
								title="Cambiar"
								onclick={() => edit(p)}>✎</button
							>
							<button
								class="{button} shrink-0 px-2 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
								aria-label="Borrar {p.name}"
								title="Borrar"
								onclick={() => (deleting = p.id)}>✕</button
							>
						</div>
						{#if p.notes}
							<p class="mt-1 text-sm break-words whitespace-pre-wrap text-zinc-300">{p.notes}</p>
						{/if}
						{#if deleting === p.id}
							<form
								method="post"
								action="?/delete"
								use:enhance={() =>
									({ update }) => {
										deleting = null;
										return update();
									}}
								class="mt-2 flex flex-wrap items-center gap-2"
							>
								<input type="hidden" name="id" value={p.id} />
								<span class="text-sm">¿Borrar «{p.name}» y su fichero? No se puede deshacer.</span>
								<button class="{button} bg-red-700 hover:bg-red-600">Sí</button>
								<button
									type="button"
									class="{button} hover:bg-zinc-800"
									onclick={() => (deleting = null)}>No</button
								>
							</form>
						{/if}
					{/if}
				</li>
			{:else}
				<li class="py-4 text-zinc-400">
					{data.papers.length ? 'Nada con eso.' : 'Ningún papel guardado todavía.'}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<script module lang="ts">
	import { goto, refreshAll } from '$app/navigation';
	import type { ActionResult } from '$app/forms';
	import type { PaperCategory } from 'comun/papers.ts';

	/** A paper being written: new (`id` null) or corrected. */
	export interface PaperDraft {
		id: number | null;
		name: string;
		category: PaperCategory;
		notes: string;
		people: string[];
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
	import type { AgendaPerson } from 'comun/agenda.ts';
	import { MAX_PAPER_MB, MAX_PAPER_NAME, MAX_PAPER_NOTES, PAPER_CATEGORIES } from 'comun/papers.ts';
	import PaperPick from '#lib/components/PaperPick.svelte';
	import { NotASheet, paperFile, PaperTooBig } from '#lib/paper-pages.ts';

	/**
	 * The form of a paper (#384), in Papeles and in an event of the agenda (#399), which sends it to
	 * Papeles' own action. A new key for each one.
	 */
	let {
		action,
		draft,
		people,
		eventId = null,
		files = [],
		onclose
	}: {
		action: string;
		draft: PaperDraft;
		/** Whose it can be. */
		people: AgendaPerson[];
		/** New, it belongs to this event of the agenda. */
		eventId?: number | null;
		/** The photos or files it was opened with: its first pages. */
		files?: File[];
		onclose: () => void;
	} = $props();

	const start = untrack(() => draft);
	let name = $state(start.name);
	let category = $state(start.category);
	let notes = $state(start.notes);
	let owners = $state([...start.people]);
	let problem = $state<string | null>(null);
	let sending = $state(false);
	/** Its pages are being put together, before it is sent. */
	let joining = $state(false);
	/** Its pages, in their order: one is sent as it is, several as one PDF (paper-pages.ts). */
	let pages = $state(untrack(() => [...files]));

	/** A small picture of each page that is a photo. */
	const previews = $derived(
		pages.map((p) => (p.type.startsWith('image/') ? URL.createObjectURL(p) : null))
	);
	$effect(() => {
		const urls = previews;
		return () => urls.forEach((url) => url && URL.revokeObjectURL(url));
	});

	/** The page at `i` swapped with the one `by` beside it. */
	function move(i: number, by: -1 | 1) {
		const next = [...pages];
		[next[i], next[i + by]] = [next[i + by]!, next[i]!];
		pages = next;
	}

	const field =
		'rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500';
	const button = 'rounded-md px-3 py-1.5 text-sm disabled:opacity-40';
</script>

<form
	method="post"
	{action}
	enctype="multipart/form-data"
	class="flex flex-col gap-3 rounded-lg bg-zinc-900 p-3"
	use:enhance={async ({ formData, cancel }) => {
		problem = null;
		sending = true;
		if (pages.length) {
			joining = pages.length > 1;
			try {
				formData.set('fichero', await paperFile(pages));
			} catch (err) {
				problem =
					err instanceof PaperTooBig || err instanceof NotASheet
						? err.message
						: 'No se han podido juntar las páginas';
				sending = false;
				cancel();
				return;
			} finally {
				joining = false;
			}
		}
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
	{#if people.length}
		<div>
			<p class="mb-1 text-xs text-zinc-400">De quién es (si es de alguien)</p>
			<div class="flex flex-wrap gap-2">
				{#each people as p (p.id)}
					{@const on = owners.includes(p.id)}
					<button
						type="button"
						aria-pressed={on}
						class={[
							'rounded-full border px-3 py-1 text-sm',
							on
								? 'border-amber-500 text-amber-300'
								: 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
						]}
						onclick={() => (owners = on ? owners.filter((id) => id !== p.id) : [...owners, p.id])}
						>{p.name}</button
					>
				{/each}
			</div>
			{#each owners as id (id)}
				<input type="hidden" name="people" value={id} />
			{/each}
		</div>
	{/if}
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
	<div>
		<p class="mb-1 text-xs text-zinc-400">
			{start.id ? 'Otro fichero (si quieres cambiarlo)' : 'Páginas'}: fotos o PDF; si son varias, se
			guardan juntas en un PDF (hasta {MAX_PAPER_MB} MB)
		</p>
		{#if pages.length}
			<ol class="mb-2 flex flex-wrap gap-2">
				{#each pages as page, i (i)}
					<li class="flex w-24 flex-col items-center gap-1 rounded-md bg-zinc-950 p-1">
						{#if previews[i]}
							<img
								src={previews[i]}
								alt="Página {i + 1}"
								class="h-28 w-full rounded object-cover"
							/>
						{:else}
							<div class="flex h-28 w-full items-center justify-center text-3xl" aria-hidden="true">
								📄
							</div>
						{/if}
						<span class="w-full truncate text-center text-xs text-zinc-400" title={page.name}
							>{i + 1}{previews[i] ? '' : ` · ${page.name}`}</span
						>
						<div class="flex">
							<button
								type="button"
								class="{button} px-2 text-zinc-300 hover:bg-zinc-800"
								disabled={i === 0}
								aria-label="Pasar la página {i + 1} antes"
								onclick={() => move(i, -1)}>←</button
							>
							<button
								type="button"
								class="{button} px-2 text-zinc-300 hover:bg-zinc-800"
								aria-label="Quitar la página {i + 1}"
								onclick={() => (pages = pages.filter((_, j) => j !== i))}>✕</button
							>
							<button
								type="button"
								class="{button} px-2 text-zinc-300 hover:bg-zinc-800"
								disabled={i === pages.length - 1}
								aria-label="Pasar la página {i + 1} después"
								onclick={() => move(i, 1)}>→</button
							>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
		<div class="flex flex-wrap gap-2">
			<PaperPick adding={pages.length > 0} onpick={(more) => (pages = [...pages, ...more])} />
		</div>
	</div>
	<div class="flex gap-2">
		<button
			class="{button} bg-amber-500 font-medium text-zinc-950 hover:bg-amber-400"
			disabled={sending || (!start.id && !pages.length)}
		>
			{joining ? 'Juntando las páginas…' : sending ? 'Guardando…' : 'Guardar'}
		</button>
		<button type="button" class="{button} text-zinc-400 hover:bg-zinc-800" onclick={onclose}
			>Cancelar</button
		>
	</div>
	{#if problem}<p class="text-sm text-red-400">{problem}</p>{/if}
</form>

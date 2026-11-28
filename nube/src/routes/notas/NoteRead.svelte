<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import NoteIcon from '#lib/components/NoteIcon.svelte';
	import type { Note, NoteArticle } from '#lib/notes.ts';

	/**
	 * A note of Textos read whole, in its tab (2026-11-28): a web's article as it was cleaned when
	 * saved (sanitized there and on loading: only text, its shape and links), or a written note,
	 * with what can be done to it. `act`, a form's action here; `back`, the list it came from,
	 * where it goes once deleted.
	 */
	interface Props {
		note: Note;
		article: NoteArticle | null;
		justSaved: boolean;
		act: (name: string, back?: boolean) => string;
		back: string;
	}
	let { note: n, article: a, justSaved, act, back }: Props = $props();

	const when = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });
	const host = $derived(n.link ? new URL(n.link).hostname.replace(/^www\./, '') : '');
	/** Their own words, when they are more than the article's name. */
	const own = $derived(n.text.trim() && n.text.trim() !== a?.title ? n.text.trim() : null);
	let editing = $state(false);
	let deleting = $state(false);
</script>

<div class="mx-auto max-w-2xl">
	<p class="mb-3 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
		<NoteIcon
			name={n.link ? 'leer' : 'texto'}
			class="h-4 w-4 {n.link ? 'text-sky-400' : 'text-amber-400'}"
		/>
		{n.link ? 'Para leer' : 'Nota'} · {when.format(new Date(n.at))}{n.author
			? ` · de ${n.author}`
			: ''}{n.shared ? ' · para toda la casa' : ''}
	</p>

	{#if editing}
		<form
			method="post"
			action={act('edit')}
			class="mb-6"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					if (result.type === 'success') editing = false;
				}}
		>
			<input type="hidden" name="id" value={n.id} />
			<textarea
				name="text"
				rows="6"
				required
				aria-label={n.link ? 'Su nombre' : 'Nota'}
				class="mb-2 w-full rounded-md border-zinc-700 bg-zinc-950 focus:border-amber-500 focus:ring-amber-500"
				>{n.text}</textarea
			>
			<input
				name="tags"
				list="etiquetas"
				value={n.tags.join(', ')}
				placeholder="Etiquetas: cocina, niños…"
				aria-label="Etiquetas, separadas por comas"
				class="mb-2 w-full rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500"
			/>
			<div class="flex gap-3 text-sm">
				<button class="rounded-md bg-amber-500 px-3 py-1 font-medium text-zinc-950">Guardar</button>
				<button type="button" class="text-zinc-400" onclick={() => (editing = false)}
					>Cancelar</button
				>
			</div>
		</form>
	{:else if n.link && a}
		<article>
			<h1 class="mb-2 text-2xl leading-tight font-bold">{a.title || n.text}</h1>
			<p class="mb-4 text-sm text-zinc-400">
				{[a.site ?? host, a.byline, `${a.minutes} min de lectura`].filter(Boolean).join(' · ')}
			</p>
			{#if own}
				<p
					class="mb-6 rounded-md border border-zinc-800 bg-zinc-900 p-3 text-sm whitespace-pre-wrap"
				>
					{own}
				</p>
			{/if}
			<div class="articulo">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized when saved and again on loading (notes-reader.ts): only text, its shape and links. -->
				{@html a.html}
			</div>
		</article>
	{:else if n.link}
		<h1 class="mb-2 text-2xl font-bold">{n.text}</h1>
		<p class="mb-4 text-zinc-300" role={justSaved ? 'status' : undefined}>
			{justSaved ? 'Guardada en Notas, con su enlace. ' : ''}Esta web no deja leerla desde Seilide
			(puede ser de pago, o no deja entrar a robots): ábrela en su propia web.
		</p>
	{:else}
		<p class="text-lg leading-relaxed break-words whitespace-pre-wrap">{n.text}</p>
	{/if}

	{#if n.tags.length && !editing}
		<p class="mt-4 flex flex-wrap gap-1.5 text-xs">
			{#each n.tags as t (t)}
				<span class="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-300">#{t}</span>
			{/each}
		</p>
	{/if}

	{#if !editing}
		<div class="mt-8 flex flex-wrap items-center gap-4 border-t border-zinc-800 pt-4 text-sm">
			{#if n.link}
				<a
					href={n.link}
					target="_blank"
					rel="noopener noreferrer"
					class="text-amber-400 hover:underline">Abrir en {host} ↗</a
				>
			{/if}
			{#if n.canEdit}
				<button class="text-zinc-400 hover:text-white" onclick={() => (editing = true)}
					>Corregir</button
				>
				{#if n.mine}
					<form method="post" action={act('share')} use:enhance>
						<input type="hidden" name="id" value={n.id} />
						<input type="hidden" name="shared" value={n.shared ? '0' : '1'} />
						<button class="text-zinc-400 hover:text-white"
							>{n.shared ? 'Solo para mí' : 'Compartir con la casa'}</button
						>
					</form>
				{/if}
				{#if deleting}
					<!-- Gone, back to the list: also without JavaScript, by where it is sent. -->
					<form
						method="post"
						action={act('delete', true)}
						class="flex gap-3"
						use:enhance={() =>
							async ({ result, update }) => {
								if (result.type === 'success') await goto(back, { replaceState: true });
								else await update();
							}}
					>
						<input type="hidden" name="id" value={n.id} />
						<span class="text-zinc-400">¿Borrarla?</span>
						<button class="text-red-400">Sí, borrarla</button>
						<button type="button" class="text-zinc-400" onclick={() => (deleting = false)}
							>No</button
						>
					</form>
				{:else}
					<button class="text-zinc-500 hover:text-red-400" onclick={() => (deleting = true)}
						>{n.link ? 'Ya la he leído: borrarla' : 'Borrar'}</button
					>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.articulo {
		font-size: 1.125rem;
		line-height: 1.75;
		overflow-wrap: anywhere;
	}
	.articulo :global(p),
	.articulo :global(ul),
	.articulo :global(ol),
	.articulo :global(blockquote),
	.articulo :global(pre),
	.articulo :global(table) {
		margin: 0 0 1.1em;
	}
	.articulo :global(h2),
	.articulo :global(h3),
	.articulo :global(h4),
	.articulo :global(h5),
	.articulo :global(h6) {
		margin: 1.6em 0 0.6em;
		font-weight: 700;
		line-height: 1.3;
	}
	.articulo :global(h2) {
		font-size: 1.35em;
	}
	.articulo :global(h3) {
		font-size: 1.2em;
	}
	.articulo :global(ul) {
		list-style: disc;
		padding-left: 1.4em;
	}
	.articulo :global(ol) {
		list-style: decimal;
		padding-left: 1.4em;
	}
	.articulo :global(blockquote) {
		border-left: 3px solid var(--color-zinc-600, #52525b);
		padding-left: 1em;
		opacity: 0.85;
	}
	.articulo :global(pre) {
		overflow-x: auto;
		font-size: 0.85em;
		padding: 0.8em;
		border-radius: 0.375rem;
		background: color-mix(in srgb, currentColor 8%, transparent);
	}
	.articulo :global(code) {
		font-size: 0.9em;
	}
	.articulo :global(a) {
		color: var(--color-amber-400, #fbbf24);
		text-decoration: underline;
	}
	.articulo :global(td),
	.articulo :global(th) {
		border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
		padding: 0.3em 0.6em;
	}
	.articulo :global(hr) {
		margin: 2em 0;
		opacity: 0.3;
	}
</style>

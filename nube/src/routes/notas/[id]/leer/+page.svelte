<script lang="ts">
	import type { PageProps } from './$types';

	/**
	 * «Leer» (#634): the article as it was cleaned when saved (sanitized there: only text, its shape
	 * and links), in a comfortable column. Only to read; the note's own words are corrected in Notas.
	 */
	let { data }: PageProps = $props();

	const n = $derived(data.note);
	const a = $derived(data.article);
	const host = $derived(n.link ? new URL(n.link).hostname.replace(/^www\./, '') : '');
	/** Their own words, when they are more than the article's name. */
	const own = $derived(n.text.trim() && n.text.trim() !== a?.title ? n.text.trim() : null);
	let deleting = $state(false);
</script>

<svelte:head><title>{a?.title || n.text || 'Para leer'} · Seilide</title></svelte:head>

<div class="mx-auto max-w-2xl">
	<a href="/notas?leer" class="text-sm text-zinc-400 hover:text-white">← Para leer</a>

	{#if a}
		<article class="mt-4">
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
	{:else}
		<h1 class="mt-4 mb-2 text-2xl font-bold">{n.text}</h1>
		<p class="mb-4 text-zinc-300" role={data.justSaved ? 'status' : undefined}>
			{data.justSaved ? 'Guardada en Notas, con su enlace. ' : ''}Esta web no deja leerla desde
			Seilide (puede ser de pago, o no deja entrar a robots): ábrela en su propia web.
		</p>
	{/if}

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
			{#if deleting}
				<form method="post" action="?/delete" class="flex gap-3">
					<span class="text-zinc-400">¿Borrarla?</span>
					<button class="text-red-400">Sí, borrarla</button>
					<button type="button" class="text-zinc-400" onclick={() => (deleting = false)}>No</button>
				</form>
			{:else}
				<button class="text-zinc-500 hover:text-red-400" onclick={() => (deleting = true)}
					>Ya la he leído: borrarla</button
				>
			{/if}
		{/if}
	</div>
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

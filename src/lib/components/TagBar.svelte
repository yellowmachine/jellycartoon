<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ClassValue } from 'svelte/elements';

	/**
	 * A series' or a film's tags: their page's `addTag` and `removeTag` actions. Only the ones it
	 * has, as chips that read over the frame behind the page (Backdrop.svelte); the rest (other
	 * tags to add with one touch, a new one, managing them) in «+ Etiqueta», a panel of its own.
	 */
	let {
		tags,
		allTags,
		class: className
	}: { tags: { id: number; name: string }[]; allTags: string[]; class?: ClassValue } = $props();

	let otherTags = $derived(allTags.filter((name) => !tags.some((t) => t.name === name)));

	/** Dark and a little see-through, blurring what is behind: readable over any frame. */
	const chip =
		'rounded-full border border-white/10 bg-zinc-950/70 shadow-sm backdrop-blur-md text-zinc-100';
</script>

<div class={['flex flex-wrap items-center gap-2 text-sm', className]}>
	{#each tags as tag (tag.id)}
		<form method="post" action="?/removeTag" use:enhance>
			<input type="hidden" name="tagId" value={tag.id} />
			<span class={[chip, 'flex items-center gap-1 py-0.5 pr-1 pl-3']}>
				{tag.name}
				<button
					class="rounded-full px-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
					title="Quitar la etiqueta «{tag.name}»"
					aria-label="Quitar la etiqueta «{tag.name}»">×</button
				>
			</span>
		</form>
	{/each}

	<!-- Native popover: closes with Esc or a click outside, under its button. -->
	<button
		class={[chip, 'px-3 py-0.5 text-zinc-300 hover:text-white']}
		popovertarget="tag-menu"
		style:anchor-name="--tag-menu">+ Etiqueta</button
	>
	<div
		id="tag-menu"
		popover="auto"
		style:position-anchor="--tag-menu"
		class="tag-menu inset-auto m-0 mt-1 w-72 rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-100 shadow-lg"
	>
		{#if otherTags.length}
			<p class="mb-2 text-xs text-zinc-400">Las que ya tienen otras:</p>
			<div class="mb-3 flex flex-wrap gap-1.5">
				{#each otherTags as name (name)}
					<form method="post" action="?/addTag" use:enhance>
						<input type="hidden" name="name" value={name} />
						<button
							class="rounded-full border border-zinc-700 px-3 py-0.5 text-zinc-300 hover:border-zinc-500 hover:text-white"
							title="Añadir la etiqueta «{name}»">+ {name}</button
						>
					</form>
				{/each}
			</div>
		{/if}
		<form method="post" action="?/addTag" use:enhance class="mb-3">
			<input
				name="name"
				maxlength="40"
				autocomplete="off"
				placeholder="Nueva etiqueta"
				aria-label="Nueva etiqueta"
				class="w-full rounded-md border-zinc-700 bg-zinc-950 px-3 py-1 text-sm"
			/>
		</form>
		<a
			href="/library/etiquetas"
			class="text-xs text-zinc-400 hover:text-white"
			title="Renombrar, juntar o borrar etiquetas en todas las series y películas"
			>Gestionar etiquetas</a
		>
	</div>
</div>

<style>
	/* Below the button, from its left edge; above it if there is no room underneath. */
	.tag-menu {
		position-area: bottom span-right;
		position-try-fallbacks: flip-block;
	}
</style>

<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ClassValue } from 'svelte/elements';

	/** A series' or a film's tags: their page's `addTag` and `removeTag` actions. */
	let {
		tags,
		allTags,
		class: className
	}: { tags: { id: number; name: string }[]; allTags: string[]; class?: ClassValue } = $props();

	let otherTags = $derived(allTags.filter((name) => !tags.some((t) => t.name === name)));
</script>

<div class={['flex flex-wrap items-center gap-2 text-sm', className]}>
	{#each tags as tag (tag.id)}
		<form method="post" action="?/removeTag" use:enhance>
			<input type="hidden" name="tagId" value={tag.id} />
			<span
				class="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 py-0.5 pr-1 pl-3"
			>
				{tag.name}
				<button
					class="rounded-full px-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
					title="Quitar la etiqueta «{tag.name}»"
					aria-label="Quitar la etiqueta «{tag.name}»">×</button
				>
			</span>
		</form>
	{/each}
	<!-- Tags others already have: one click instead of typing them again. -->
	{#each otherTags as name (name)}
		<form method="post" action="?/addTag" use:enhance>
			<input type="hidden" name="name" value={name} />
			<button
				class="rounded-full border border-dashed border-zinc-700 px-3 py-0.5 text-zinc-500 hover:border-zinc-500 hover:text-white"
				title="Añadir la etiqueta «{name}»">+ {name}</button
			>
		</form>
	{/each}
	<form method="post" action="?/addTag" use:enhance>
		<input
			name="name"
			maxlength="40"
			autocomplete="off"
			placeholder="Nueva etiqueta"
			aria-label="Nueva etiqueta"
			class="w-36 rounded-full border-zinc-700 bg-zinc-900 px-3 py-0.5 text-sm"
		/>
	</form>
	<a
		href="/library/etiquetas"
		class="text-zinc-500 hover:text-white"
		title="Renombrar, juntar o borrar etiquetas en todas las series y películas"
		>Gestionar etiquetas</a
	>
</div>

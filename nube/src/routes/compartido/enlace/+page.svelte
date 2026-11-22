<script lang="ts">
	import { enhance } from '$app/forms';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { primary, secondary, select } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	/**
	 * What to do with a shared link (#586): a wish of someone's, or a recipe. A known shop's, with the
	 * wish first and marked; any other, the recipe.
	 */
	let { data, form }: PageProps = $props();

	const shopFirst = $derived(Boolean(data.shop));
	const host = $derived(new URL(data.link).hostname.replace(/^www\./, ''));
	/** What came with it (Android puts the address in the text too): without addresses. */
	const said = $derived(
		data.text
			.replace(/https?:\/\/\S+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
	);
	let forWhom = $state('');
	$effect(() => {
		if (!forWhom) forWhom = data.people.find((p) => p.me)?.id ?? data.people[0]?.id ?? '';
	});
	let saving = $state(false);
	const card = 'rounded-lg border p-4 flex flex-col gap-3';
</script>

<svelte:head><title>Enlace compartido</title></svelte:head>

<h1 class="mb-1 text-2xl font-bold">¿Qué hago con este enlace?</h1>
<p class="mb-6 truncate text-sm text-zinc-400" title={data.link}>
	{said ? `${said} · ` : ''}{data.shop ?? host}
</p>

<div class="flex gap-4 {shopFirst ? 'flex-col' : 'flex-col-reverse'}">
	{#if data.people.length}
		<form
			method="post"
			action="?/wish"
			class="{card} {shopFirst ? 'border-amber-500/60 bg-amber-500/5' : 'border-zinc-800'}"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					saving = false;
					await update();
				};
			}}
		>
			<input type="hidden" name="url" value={data.link} />
			<input type="hidden" name="texto" value={data.text} />
			<h2 class="flex items-center gap-2 font-semibold">
				<SectionIcon name="deseos" class="h-6 w-6" />A la lista de deseos
			</h2>
			<div class="flex flex-wrap items-center gap-2">
				{#if data.people.length > 1}
					<label class="text-sm text-zinc-400">
						De
						<select name="persona" bind:value={forWhom} class="{select} ml-1">
							{#each data.people as p (p.id)}
								<option value={p.id}>{p.me ? 'mí' : p.name}</option>
							{/each}
						</select>
					</label>
				{:else}
					<input type="hidden" name="persona" value={forWhom} />
				{/if}
				<button class={shopFirst ? primary : secondary} disabled={saving}
					>{saving ? 'Leyendo la página…' : 'Guardar en deseos'}</button
				>
			</div>
			{#if form?.message}<p class="text-sm text-red-400" role="alert">{form.message}</p>{/if}
		</form>
	{/if}

	<div class="{card} {shopFirst ? 'border-zinc-800' : 'border-amber-500/60 bg-amber-500/5'}">
		<h2 class="flex items-center gap-2 font-semibold">
			<SectionIcon name="recetas" class="h-6 w-6" />Es una receta
		</h2>
		<div>
			<a
				href="/recetas?url={encodeURIComponent(data.link)}"
				class="inline-block {shopFirst ? secondary : primary}">Guardar en Recetas</a
			>
		</div>
	</div>
</div>

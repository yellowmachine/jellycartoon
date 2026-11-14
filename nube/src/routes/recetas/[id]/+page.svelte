<script lang="ts">
	import { deserialize, enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { smallerPhoto } from 'comun/receipt-photo.ts';
	import Backdrop from 'comun/components/Backdrop.svelte';
	import Espera from '#lib/components/Espera.svelte';
	import ShoppingCard from '#lib/components/ShoppingCard.svelte';
	import type { RecipeShoppingItem } from '#lib/recipe-shopping.ts';
	import { describeTimer, parseRecipe, type Recipe } from 'comun/recipe.ts';
	import { kitchenMode } from '#lib/kitchen-mode.svelte.ts';
	import { recipe as inProgress } from '#lib/recipe.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const r = $derived(data.recipe);
	let confirmDelete = $state(false);
	let confirmReplace = $state(false);

	/** As the kitchen takes it; without steps, nothing to cook. */
	const cookable = $derived.by((): Recipe | null => {
		const parsed = parseRecipe(r);
		return typeof parsed === 'string' ? null : parsed;
	});
	/** This one is already being cooked: going back to it, not starting over. */
	const cooking = $derived(inProgress.current?.title === cookable?.title);

	function cook() {
		confirmReplace = false;
		if (cookable) void kitchenMode.cook(cookable, 0, true);
	}

	/** «Añadir a la compra»: its things to buy, once asked for; what is on the list, then. */
	let shopping = $state<RecipeShoppingItem[] | null>(null);
	let byAi = $state(true);
	let buying = $state<string[]>([]);
	let added = $state<string[] | null>(null);
	let preparing = $state(false);
	let shoppingProblem = $state<string | null>(null);

	/** Its picture: the family's own photo, or one of the dish from the favourite sites. */
	let photoBusy = $state<'subiendo' | 'buscando' | null>(null);
	let photoProblem = $state<string | null>(null);
	let confirmRemovePhoto = $state(false);

	/** Sent to an action, and the page read again after it. */
	async function act(action: string, body = new FormData()) {
		photoProblem = null;
		const res = await fetch(`?/${action}`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		}).catch(() => null);
		const result = res ? deserialize(await res.text()) : null;
		if (result?.type === 'success') await refreshAll();
		else
			photoProblem =
				result?.type === 'failure'
					? String(result.data?.photoProblem ?? 'No se pudo')
					: 'No se pudo: prueba otra vez';
	}

	async function putPhoto(input: HTMLInputElement) {
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		photoBusy = 'subiendo';
		const small = await smallerPhoto(file, { longest: 1600, quality: 0.85 });
		const body = new FormData();
		body.set(
			'photo',
			small instanceof File ? small : new File([small], 'plato.jpg', { type: small.type })
		);
		await act('photo', body);
		photoBusy = null;
	}

	async function lookForPicture() {
		photoBusy = 'buscando';
		await act('findPicture');
		photoBusy = null;
	}
</script>

<svelte:head>
	<title>{r.title} · Recetario · Seilide</title>
</svelte:head>

<a href="/recetas" class="text-sm text-zinc-400 hover:text-white">← Recetario</a>

{#if r.imageUrl}<Backdrop src={r.imageUrl} />{/if}

<header class="mt-2 mb-6">
	<div class="min-w-0">
		<h1 class="text-2xl font-bold [text-shadow:0_1px_10px_rgb(0_0_0/0.9)]">{r.title}</h1>
		<p class="text-zinc-400 [text-shadow:0_1px_10px_rgb(0_0_0/0.9)]">
			{r.servings ? `Para ${r.servings} · ` : ''}{#if data.link}De
				<a href={data.link} target="_blank" rel="noreferrer" class="hover:underline"
					>{r.sourceName}</a
				>{:else}{r.sourceName}{/if}
		</p>
		<div class="mt-4 flex flex-wrap items-center gap-2">
			{#if cookable}
				{#if confirmReplace}
					<span class="text-sm text-zinc-300"
						>¿Dejar «{inProgress.current?.title}» y cocinar esta?</span
					>
					<button
						class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
						onclick={cook}>Sí</button
					>
					<button
						class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
						onclick={() => (confirmReplace = false)}>No</button
					>
				{:else}
					<button
						class="rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400"
						onclick={() => {
							if (cooking) void kitchenMode.enter(true);
							else if (inProgress.current) confirmReplace = true;
							else cook();
						}}
						>🍳 {cooking
							? `Seguir cocinando · paso ${inProgress.step + 1} de ${cookable.steps.length}`
							: 'Cocinar'}</button
					>
				{/if}
			{/if}
			{#if r.imageUrl}
				<form method="post" action="?/backdrop" use:enhance>
					<button
						class={[
							'rounded-md px-3 py-1.5 text-sm hover:bg-zinc-800',
							data.isBackdrop ? 'text-amber-400' : 'text-zinc-400 hover:text-white'
						]}
						aria-pressed={data.isBackdrop}
						title="Su imagen, de fondo de la página del recetario"
						>{data.isBackdrop ? 'Fondo del recetario ✓' : 'Usar de fondo del recetario'}</button
					>
				</form>
			{/if}
			<!-- Its picture (#470's recipes have none): the family's photo, or one from their sites. -->
			<label
				class={[
					'cursor-pointer rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white',
					photoBusy && 'pointer-events-none opacity-50'
				]}
			>
				{photoBusy === 'subiendo'
					? 'Subiendo…'
					: r.hasPhoto
						? '📷 Cambiar la foto'
						: '📷 Poner foto'}
				<input
					type="file"
					accept="image/*"
					class="sr-only"
					disabled={photoBusy !== null}
					onchange={(e) => putPhoto(e.currentTarget)}
				/>
			</label>
			{#if !r.imageUrl}
				<button
					class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
					disabled={photoBusy !== null}
					onclick={lookForPicture}
					>{photoBusy === 'buscando' ? 'Buscando…' : '🔎 Buscar foto en mis webs'}</button
				>
			{/if}
			{#if r.hasPhoto}
				{#if confirmRemovePhoto}
					<span class="text-sm text-zinc-400">¿Quitar vuestra foto?</span>
					<button
						class="rounded-md px-3 py-1.5 text-sm text-red-400 hover:bg-zinc-800"
						onclick={async () => {
							confirmRemovePhoto = false;
							await act('removePhoto');
						}}>Sí, quitarla</button
					>
					<button
						class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
						onclick={() => (confirmRemovePhoto = false)}>No</button
					>
				{:else}
					<button
						class="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-white"
						onclick={() => (confirmRemovePhoto = true)}>Quitar la foto</button
					>
				{/if}
			{/if}
			{#if confirmDelete}
				<form method="post" action="?/delete" use:enhance class="flex items-center gap-2">
					<span class="text-sm text-zinc-400">¿Quitarla del recetario?</span>
					<button class="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
						>Quitar</button
					>
					<button
						type="button"
						class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
						onclick={() => (confirmDelete = false)}>No</button
					>
				</form>
			{:else}
				<button
					class="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-white"
					onclick={() => (confirmDelete = true)}>Quitar</button
				>
			{/if}
		</div>
		{#if photoProblem}<p class="mt-2 text-sm text-red-400" role="alert">{photoProblem}</p>{/if}
	</div>
</header>

<div class="grid gap-8 md:grid-cols-3">
	<section>
		<h2 class="mb-2 font-semibold">Ingredientes</h2>
		{#if shopping}
			<ShoppingCard
				items={shopping.map((s) => s.item)}
				usual={shopping.filter((s) => s.usual).map((s) => s.item)}
				{added}
				toBuy={buying}
				onadded={(data) => {
					added = [...(added ?? []), ...((data?.added as string[] | undefined) ?? [])];
					buying = (data?.toBuy as string[] | undefined) ?? buying;
				}}
			/>
			{#if !byAi}
				<p class="mt-2 text-xs text-zinc-500">
					Van como los escribe la receta: sin IA (Ajustes) no se ordenan para la compra.
				</p>
			{/if}
			<button
				class="mt-2 text-sm text-zinc-400 hover:text-white"
				onclick={() => {
					shopping = null;
					added = null;
				}}>← Ver los ingredientes</button
			>
		{:else}
			<ul class="list-disc space-y-1 pl-5 text-zinc-300">
				{#each r.ingredients as ingredient, i (i)}
					<li>{ingredient}</li>
				{:else}
					<li class="list-none text-zinc-500">La web no los dice aparte.</li>
				{/each}
			</ul>
			{#if r.ingredients.length}
				<form
					method="post"
					action="?/shopping"
					use:enhance={() => {
						preparing = true;
						shoppingProblem = null;
						return async ({ result }) => {
							preparing = false;
							if (result.type === 'success' && result.data) {
								shopping = result.data.shopping as RecipeShoppingItem[];
								byAi = Boolean(result.data.byAi);
								buying = result.data.toBuy as string[];
							} else
								shoppingProblem =
									result.type === 'failure'
										? String(result.data?.message ?? 'No se pudo')
										: 'No se pudo';
						};
					}}
				>
					<button
						class="mt-3 rounded-md px-3 py-1.5 text-sm text-amber-400 ring-1 ring-amber-500/40 hover:bg-amber-500/10 disabled:opacity-40"
						disabled={preparing}>🛒 Añadir a la compra</button
					>
				</form>
				{#if shoppingProblem}<p class="mt-2 text-sm text-red-400">{shoppingProblem}</p>{/if}
			{/if}
		{/if}
	</section>
	<section class="md:col-span-2">
		<h2 class="mb-2 font-semibold">Pasos</h2>
		<ol class="space-y-3">
			{#each r.steps as step, i (i)}
				<li class="flex gap-3">
					<span class="w-6 shrink-0 text-right text-zinc-500">{i + 1}.</span>
					<span>
						{step.text}
						{#if step.timer}
							<span class="mt-0.5 block text-sm text-amber-400">⏱ {describeTimer(step.timer)}</span>
						{/if}
					</span>
				</li>
			{/each}
		</ol>
	</section>
</div>

{#if preparing}
	<!-- The first time the AI makes them into things to buy: the screen veiled, the snail. -->
	<Espera>Preparando la lista de la compra…</Espera>
{/if}

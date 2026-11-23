<script lang="ts">
	import { onDestroy } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
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
	/** Kept from the computer's bookmark: its list, said for a moment before the tab closes. */
	let kept = $state<{ list: string; already: boolean } | null>(null);
	/** Seconds until it closes, counted down on its button. */
	let left = $state(6);
	let closing: ReturnType<typeof setTimeout> | undefined;
	onDestroy(stay);

	function stay() {
		clearTimeout(closing);
	}

	/**
	 * The bookmark opened this tab over the shop's: closed, the shop is back and tabs do not pile up.
	 * A browser that does not let it close (a shop that cuts the link, a tab with history) stays
	 * here, so on to the list as always.
	 */
	function keptFromBookmark(list: string) {
		kept = { list, already: new URL(list, location.href).searchParams.has('ya') };
		countDown();
	}

	function countDown() {
		closing = setTimeout(() => {
			left -= 1;
			if (left > 0) countDown();
			else backToShop(kept!.list);
		}, 1000);
	}

	function backToShop(list: string) {
		stay();
		window.close();
		closing = setTimeout(() => void goto(list), 400);
	}
	const card = 'rounded-lg border p-4 flex flex-col gap-3';
</script>

<svelte:head><title>Enlace compartido</title></svelte:head>

{#if kept}
	{@const list = kept.list}
	<div class="mb-6 rounded-lg border border-emerald-500/60 bg-emerald-500/10 p-4">
		<!-- Only this is announced: not each second of the count. -->
		<div role="status">
			<p class="text-lg font-semibold">
				{kept.already ? 'Ya estaba en la lista de deseos' : 'Añadido a la lista de deseos'}
			</p>
			<p class="mb-3 text-sm text-zinc-300">
				Esta pestaña se cierra sola y vuelves a la tienda. Si prefieres quedarte en Seilide, pulsa
				«Ver la lista».
			</p>
		</div>
		<div class="flex flex-wrap gap-3">
			<button type="button" class={primary} onclick={() => backToShop(list)}
				>Volver a la tienda <span class="tabular-nums" aria-hidden="true">({left})</span></button
			>
			<a href={list} onclick={stay} class={secondary}>Ver la lista</a>
		</div>
	</div>
{/if}

<h1 class="mb-1 text-2xl font-bold">¿Qué hago con este enlace?</h1>
<p class="mb-6 truncate text-sm text-zinc-400" title={data.link}>
	{said ? `${said} · ` : ''}{data.shop ?? host}
</p>

{#if data.read}
	<!-- Read by the computer's bookmark, in the person's own browser. -->
	<div class="mb-6 flex gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
		{#if data.read.imageUrl}
			<img
				src={data.read.imageUrl}
				alt=""
				referrerpolicy="no-referrer"
				class="h-20 w-20 shrink-0 rounded-md bg-white object-contain"
			/>
		{/if}
		<div class="min-w-0">
			<p class="line-clamp-2 font-medium">{data.read.title}</p>
			{#if data.read.price}<p class="text-sm text-zinc-300">{data.read.price}</p>{/if}
		</div>
	</div>
{/if}

<div class="flex gap-4 {shopFirst ? 'flex-col' : 'flex-col-reverse'}">
	{#if data.people.length}
		<form
			method="post"
			action="?/wish"
			class="{card} {shopFirst ? 'border-amber-500/60 bg-amber-500/5' : 'border-zinc-800'}"
			use:enhance={() => {
				saving = true;
				return async ({ result, update }) => {
					saving = false;
					if (data.read && result.type === 'redirect' && result.location.startsWith('/deseos?'))
						return keptFromBookmark(result.location);
					await update();
				};
			}}
		>
			<input type="hidden" name="url" value={data.link} />
			<input type="hidden" name="texto" value={data.text} />
			{#if data.read}
				<input type="hidden" name="titulo" value={data.read.title} />
				<input type="hidden" name="precio" value={data.read.precio} />
				<input type="hidden" name="foto" value={data.read.foto} />
			{/if}
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
				<button class={shopFirst ? primary : secondary} disabled={saving || Boolean(kept)}
					>{saving ? 'Leyendo la página…' : 'Guardar en deseos'}</button
				>
			</div>
			{#if form?.message}<p class="text-sm text-red-400" role="alert">{form.message}</p>{/if}
		</form>
	{/if}

	{#if data.messages}
		<div class="{card} border-zinc-800">
			<h2 class="flex items-center gap-2 font-semibold">
				<SectionIcon name="mensajes" class="h-6 w-6" />Mandarlo a alguien
			</h2>
			<div>
				<a
					href="/mensajes?{new URLSearchParams({
						enlace: data.link,
						texto: data.text,
						...(data.read
							? { titulo: data.read.title, precio: data.read.precio, foto: data.read.foto }
							: {})
					})}"
					class="inline-block {secondary}">Mandar por Mensajes</a
				>
			</div>
		</div>
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

<script lang="ts">
	import {
		cleanPageText,
		MAX_WISH_NOTE,
		MAX_WISH_TITLE,
		priceChangeText,
		readPageText,
		readPriceChange,
		type PriceChange
	} from '#lib/wishes.ts';
	import { onDestroy } from 'svelte';
	import { untrack } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { afterNavigate, goto, replaceState } from '$app/navigation';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { field, primary, secondary, select } from '#lib/styles.ts';
	import Espera from '#lib/components/Espera.svelte';
	import type { WishAnalysis } from '#lib/server/wish-analysis.ts';
	import type { PageProps } from './$types';

	/**
	 * What to do with a shared link (#586, #633): a wish of someone's, a recipe, a podcast to follow,
	 * a note to read later, or sent to someone. The likeliest first and marked (lib/shared-link.ts).
	 */
	let { data, form }: PageProps = $props();

	const first = $derived(data.order[0]);
	const marked = (place: string) =>
		first === place ? 'border-amber-500/60 bg-amber-500/5' : 'border-zinc-800';
	const button = (place: string) => (first === place ? primary : secondary);
	let following = $state(false);
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

	// ——— From the bookmark: what it read, to correct; and «Analizar con IA» ———

	let title = $state(untrack(() => data.read?.title ?? ''));
	let price = $state(untrack(() => (data.read?.price && data.read.precio) || ''));
	let shipping = $state(untrack(() => data.read?.envio ?? ''));
	let note = $state(untrack(() => data.read?.nota ?? ''));
	/** The page's text, after the #: here only, until «Analizar con IA» sends it. */
	let pageText = $state<string | null>(null);
	let analyzing = $state(false);
	/** What the AI said, or why not. */
	let analyzed = $state<string | null>(null);
	afterNavigate(() => {
		const text = readPageText(location.hash);
		if (!text) return;
		pageText = cleanPageText(text);
		// Out of the address, so it does not stay in it.
		replaceState(location.pathname + location.search, {});
	});
	const analyze: SubmitFunction = () => {
		analyzing = true;
		analyzed = null;
		return async ({ result }) => {
			analyzing = false;
			if (result.type !== 'success') {
				analyzed =
					result.type === 'failure'
						? String(result.data?.message ?? 'La IA no ha podido leerla')
						: 'La IA no ha podido leerla';
				return;
			}
			const a = result.data?.analysis as WishAnalysis;
			if (a.title) title = a.title;
			if (a.price) price = a.price;
			if (a.shipping) shipping = a.shipping;
			if (a.options) note = a.options;
			analyzed = a.price
				? 'Leído por la IA: compruébalo antes de guardar.'
				: 'Leído por la IA, sin encontrar un precio claro: compruébalo antes de guardar.';
		};
	};
	/** Kept from the computer's bookmark: its list, said for a moment before the tab closes. */
	let kept = $state<{ list: string; already: boolean; change: PriceChange | null } | null>(null);
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
		const params = new URL(list, location.href).searchParams;
		kept = {
			list,
			already: params.has('ya'),
			change: readPriceChange(params.get('precio'))
		};
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

{#if analyzing}<Espera>La IA está leyendo la página…</Espera>{/if}

{#if kept}
	{@const list = kept.list}
	<div class="mb-6 rounded-lg border border-emerald-500/60 bg-emerald-500/10 p-4">
		<!-- Only this is announced: not each second of the count. -->
		<div role="status">
			<p class="text-lg font-semibold">
				{kept.already
					? 'Ya estaba en la lista de deseos'
					: 'Añadido a la lista de deseos'}{kept.change ? `: ${priceChangeText(kept.change)}` : ''}
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

{#if data.oldBookmark}
	<p class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">
		Tu marcador es de una versión anterior: lee peor los precios y no sabe si la página es una
		receta o un podcast. Bórralo y arrastra «📥 A Seilide» desde
		<a
			href="/ajustes?seccion=aparato#marcador"
			data-sveltekit-reload
			class="text-amber-400 hover:underline">Ajustes → Este aparato</a
		>.
	</p>
{/if}

{#if data.read}
	<!-- Read by the computer's bookmark, in the person's own browser. -->
	<div class="mb-6 flex gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
		{#if data.read.imageUrl}
			<img
				src={data.read.imageUrl}
				alt=""
				referrerpolicy="no-referrer"
				class="h-20 w-20 shrink-0 rounded-md bg-claro object-contain"
			/>
		{/if}
		<div class="min-w-0 flex-1">
			<div class="flex flex-col gap-2">
				<input
					bind:value={title}
					maxlength={MAX_WISH_TITLE}
					aria-label="Nombre"
					class="{field} py-1 text-sm"
				/>
				<div class="flex flex-wrap gap-2">
					<input
						bind:value={price}
						maxlength="20"
						placeholder="Precio: 12,30 €"
						aria-label="Precio"
						class="{field} max-w-36 py-1 text-sm"
					/>
					<!-- Beside the price it would look like another one: said. -->
					<label class="flex items-center gap-2 text-sm text-zinc-400">
						Envío
						<input
							bind:value={shipping}
							maxlength="20"
							placeholder="4,99 o gratis"
							class="{field} max-w-32 py-1 text-sm"
						/>
					</label>
				</div>
				<input
					bind:value={note}
					maxlength={MAX_WISH_NOTE}
					placeholder="Nota: talla, color…"
					aria-label="Nota"
					class="{field} py-1 text-sm"
				/>
			</div>
			{#if data.ai && pageText}
				<form method="post" action="?/analyze" use:enhance={analyze} class="mt-3">
					<input type="hidden" name="pagina" value={pageText} />
					<button class={price ? secondary : primary} disabled={analyzing || Boolean(kept)}
						>Analizar con IA</button
					>
					<p class="mt-1 text-xs text-zinc-400">
						{price
							? '¿No es el precio, o falta lo que elegiste?'
							: 'No se ha encontrado el precio.'} Le manda el texto de la página a la IA de la familia.
					</p>
				</form>
			{/if}
			{#if analyzed}<p class="mt-2 text-sm text-amber-300" role="status">{analyzed}</p>{/if}
		</div>
	</div>
{/if}

{#if form?.message}<p class="mb-4 text-sm text-red-400" role="alert">{form.message}</p>{/if}

<div class="flex flex-col gap-4">
	{#each data.order as place (place)}
		{#if place === 'deseos'}
			<form
				method="post"
				action="?/wish"
				class="{card} {marked('deseos')}"
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
					<input type="hidden" name="titulo" value={title} />
					<input type="hidden" name="precio" value={price} />
					<input type="hidden" name="envio" value={shipping} />
					<input type="hidden" name="nota" value={note} />
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
					<button class={button('deseos')} disabled={saving || Boolean(kept)}
						>{saving ? 'Leyendo la página…' : 'Guardar en deseos'}</button
					>
				</div>
			</form>
		{:else if place === 'receta'}
			<div class="{card} {marked('receta')}">
				<h2 class="flex items-center gap-2 font-semibold">
					<SectionIcon name="recetas" class="h-6 w-6" />Es una receta
				</h2>
				<div>
					<a
						href="/recetas?url={encodeURIComponent(data.link)}"
						class="inline-block {button('receta')}">Guardar en Recetas</a
					>
				</div>
			</div>
		{:else if place === 'podcast' && data.podcast}
			{@const pod = data.podcast}
			<div class="{card} {marked('podcast')}">
				<h2 class="flex items-center gap-2 font-semibold">
					<SectionIcon name="radio" class="h-6 w-6" />Es un podcast
				</h2>
				<div class="flex items-center gap-3">
					{#if pod.imageUrl}
						<img
							src={pod.imageUrl}
							alt=""
							referrerpolicy="no-referrer"
							class="h-14 w-14 shrink-0 rounded-md object-cover"
						/>
					{/if}
					<p class="min-w-0 flex-1 font-medium">{pod.title}</p>
				</div>
				{#if pod.followed}
					<p class="text-sm" role="status">
						Ya lo tienes.
						<a href="/radio/podcasts/{pod.followed}" class="text-amber-400 hover:underline"
							>Verlo en Podcasts</a
						>
					</p>
				{:else}
					<form
						method="post"
						action="?/podcast"
						use:enhance={() => {
							following = true;
							return async ({ update }) => {
								await update();
								following = false;
							};
						}}
					>
						<input type="hidden" name="feed" value={pod.feedUrl} />
						<button class={button('podcast')} disabled={following}
							>{following ? 'Leyendo sus episodios…' : 'Suscribirme al podcast'}</button
						>
					</form>
				{/if}
			</div>
		{:else if place === 'notas'}
			<form method="post" action="?/note" class="{card} {marked('notas')}">
				<input type="hidden" name="url" value={data.link} />
				<input type="hidden" name="titulo" value={data.read ? title : said} />
				<h2 class="flex items-center gap-2 font-semibold">
					<SectionIcon name="notas" class="h-6 w-6" />Para leerlo luego
				</h2>
				<div>
					<button class={button('notas')}>Guardar en Notas</button>
					<p class="mt-1 text-xs text-zinc-400">Su nombre y el enlace, solo para ti.</p>
				</div>
			</form>
		{/if}
	{/each}

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
						...(data.read ? { titulo: title, precio: price, foto: data.read.foto } : {})
					})}"
					class="inline-block {secondary}">Mandar por Mensajes</a
				>
			</div>
		</div>
	{/if}
</div>

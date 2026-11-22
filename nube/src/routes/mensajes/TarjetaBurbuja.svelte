<script lang="ts">
	import ChatRecipeCard from '#lib/components/ChatRecipeCard.svelte';
	import ShoppingCard from '#lib/components/ShoppingCard.svelte';
	import CitaCard from '#lib/components/CitaCard.svelte';
	import SitioCard from './SitioCard.svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { elsewhere } from '#lib/mensajes/elsewhere.ts';
	import { metresBetween } from 'comun/road-guide.ts';
	import { enhance } from '$app/forms';
	import { citaKey } from '#lib/cita.ts';
	import type { StoredMessage } from '#lib/mensajes/messenger.ts';

	/**
	 * Mensajes (#555): a recipe or a list sent in a message, as Preguntar shows them, to take with a
	 * touch into this person's own family: the recipe into Recetas (once per message) or cooked now,
	 * the list's ticked things onto the shopping list. In the same family that is referring: the book
	 * and the list are everyone's, so once one takes it, all see it taken; a linked family keeps its
	 * own copy.
	 */
	let {
		m,
		toBuy,
		saved,
		inAgenda,
		myPlaces
	}: {
		m: StoredMessage;
		toBuy: string[];
		/** What is in the family's Agenda (citaKey): a plan noted by anyone shows as noted. */
		inAgenda: string[];
		/** This person's kept places: one sent that they have already shows as kept. */
		myPlaces: { name: string; at: [number, number] }[];
		/** Which of the family's recipes came in which message: saved by anyone of the family. */
		saved: Record<string, number>;
	} = $props();

	const from = $derived(`${m.conversationId}/${m.key}`);
	/** Saved from here just now, before the page's data is read again. */
	let justSaved = $state<number | null>(null);
	const savedId = $derived(saved[from] ?? justSaved);
	let added = $state<string[] | null>(null);
	let noted = $state(false);
	let kept = $state(false);
	let keeping = $state(false);
	/** Kept already: about the same point (a few metres). */
	const NEAR_M = 30;
	const isKept = (p: { lat: number; lon: number }) =>
		kept || myPlaces.some((x) => metresBetween(x.at, [p.lon, p.lat]) < NEAR_M);
	let noting = $state(false);
	let notProblem = $state<string | null>(null);
</script>

{#if m.card?.kind === 'receta'}
	<ChatRecipeCard
		card={{ kind: 'receta', recipe: m.card.recipe, savedId }}
		save={{
			action: '?/save',
			fields: { recipe: JSON.stringify(m.card.recipe), from }
		}}
		onsaved={(id) => (justSaved = id)}
	/>
{:else if m.card?.kind === 'enlace-receta'}
	<!-- One of the family's own book: only which (the same family refers, #555). -->
	<div class="rounded-xl border border-zinc-700 bg-zinc-900/80 p-3">
		<p class="font-semibold">🍰 {m.card.title}</p>
		<p class="text-sm text-zinc-400">En vuestro recetario</p>
		<a
			href="/recetas/{m.card.id}"
			class="mt-2 inline-block rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400"
			>Abrir la receta</a
		>
	</div>
{:else if m.card?.kind === 'cita'}
	{@const cita = m.card}
	<CitaCard {cita}>
		{#if noted || inAgenda.includes(citaKey(cita))}
			<a href="/agenda?dia={cita.day}" class="text-sm text-emerald-400 hover:underline"
				>En la Agenda ✓</a
			>
		{:else}
			<form
				method="post"
				action="?/addEvent"
				use:enhance={() => {
					noting = true;
					notProblem = null;
					return async ({ result }) => {
						noting = false;
						if (result.type === 'success') noted = true;
						else notProblem = 'No se ha podido apuntar';
					};
				}}
			>
				<input type="hidden" name="cita" value={JSON.stringify(cita)} />
				<button
					class="rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
					disabled={noting}>{noting ? 'Apuntando…' : 'Añadir a la Agenda'}</button
				>
			</form>
			<a
				href="/agenda?dia={cita.day}"
				class="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
				>Ver ese día</a
			>
		{/if}
	</CitaCard>
	{#if notProblem}<p class="mt-1 text-sm text-red-400">{notProblem}</p>{/if}
{:else if m.card?.kind === 'sitio'}
	{@const place = m.card}
	<!-- Each person's own (#151): kept as a copy, also within the family. -->
	<SitioCard {place}>
		<a
			href="/carretera?{new URLSearchParams({
				destino: `${place.lon},${place.lat}`,
				nombre: place.name
			})}"
			class="rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400"
			>🚗 Llevarme</a
		>
		<a
			href={elsewhere(place.lat, place.lon)}
			target="_blank"
			rel="noopener noreferrer"
			class="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
			>Abrir</a
		>
		{#if isKept(place)}
			<span class="text-sm text-emerald-400">En mis sitios ✓</span>
		{:else}
			<form
				method="post"
				action="?/savePlace"
				use:enhance={() => {
					keeping = true;
					return async ({ result }) => {
						keeping = false;
						if (result.type === 'success') kept = true;
					};
				}}
			>
				<input type="hidden" name="sitio" value={JSON.stringify(place)} />
				<button
					class="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
					disabled={keeping}>{keeping ? 'Guardando…' : 'Guardar en mis sitios'}</button
				>
			</form>
		{/if}
	</SitioCard>
{:else if m.card?.kind === 'enlace'}
	{@const link = m.card}
	<div class="flex gap-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3">
		<a
			href={link.url}
			target="_blank"
			rel="noopener noreferrer"
			class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white"
			tabindex="-1"
			aria-hidden="true"
		>
			{#if link.imageUrl}
				<img
					src={link.imageUrl}
					alt=""
					loading="lazy"
					referrerpolicy="no-referrer"
					class="h-full w-full object-contain"
				/>
			{:else}
				<SectionIcon name="deseos" class="h-8 w-8 text-zinc-400" />
			{/if}
		</a>
		<div class="min-w-0 flex-1">
			<a
				href={link.url}
				target="_blank"
				rel="noopener noreferrer"
				class="line-clamp-2 font-medium hover:underline">{link.title}</a
			>
			<p class="text-sm text-zinc-400">{link.shop}{link.price ? ` · ${link.price}` : ''}</p>
			<a
				href="/compartido/enlace?{new URLSearchParams({ url: link.url, texto: link.title })}"
				class="text-sm text-amber-400 hover:underline">A la lista de deseos</a
			>
		</div>
	</div>
{:else if m.card?.kind === 'compra'}
	<ShoppingCard
		items={m.card.items}
		{added}
		{toBuy}
		action="?/add"
		onadded={(data) => (added = Array.isArray(data?.added) ? (data.added as string[]) : added)}
	/>
{/if}

<script lang="ts">
	import TripMap from '#lib/components/TripMap.svelte';
	import { durationText } from '#lib/trips.ts';
	import { paceText, walkDistanceText } from '#lib/walks.ts';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	/**
	 * A walk shared by link (#434), for whoever has it, without an account: its map, km, time and
	 * the photos chosen, as in Paseos. Under Seilide's bar, with «Pedir invitación»: whoever likes
	 * it can ask for their own.
	 */
	let { data }: PageProps = $props();

	const day = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
	const base = $derived(`/p/${page.params.token}/fotos`);
	/** The photo shown big, over the page. */
	let shown = $state<number | null>(null);
</script>

<svelte:head>
	<title>{data.title}</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="referrer" content="no-referrer" />
	<!-- What a link's preview (WhatsApp) shows: whose walk and its km, never where. -->
	<meta property="og:title" content={data.title} />
	<meta property="og:description" content="Un paseo compartido desde Seilide." />
	<meta property="og:site_name" content="Seilide" />
</svelte:head>

<header class="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
	<div class="mx-auto flex max-w-3xl items-center justify-between gap-3">
		<a href="/" class="text-xl font-bold text-amber-400">Seilide</a>
		<a
			href="/#pedir"
			class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400"
		>
			Pedir invitación
		</a>
	</div>
</header>

<main class="mx-auto max-w-3xl px-4 py-6">
	{#if data.walk}
		{@const w = data.walk}
		<h1 class="mb-1 text-2xl font-bold">{data.heading}</h1>
		<p class="mb-4 text-sm text-zinc-400 first-letter:uppercase">
			{day.format(new Date(w.startedAt))}
		</p>
		<div class="mb-4 grid grid-cols-3 gap-3">
			<div class="rounded-md border border-zinc-800 p-3">
				<p class="text-xs text-zinc-400">Distancia</p>
				<p class="text-lg font-semibold">{walkDistanceText(w.distance)}</p>
			</div>
			<div class="rounded-md border border-zinc-800 p-3">
				<p class="text-xs text-zinc-400">Tiempo</p>
				<p class="text-lg font-semibold">{durationText(w.seconds)}</p>
			</div>
			<div class="rounded-md border border-zinc-800 p-3">
				<p class="text-xs text-zinc-400">Ritmo</p>
				<p class="text-lg font-semibold">{paceText(w.distance, w.seconds) ?? '—'}</p>
			</div>
		</div>
		{#if w.pieces.length}
			<TripMap pieces={w.pieces} photos={w.photos} photoBase={base} openMap ends={!w.trimmed} />
			{#if w.trimmed}
				<p class="mt-2 text-xs text-zinc-500">
					Sin el principio ni el final del recorrido, que suelen estar en casa.
				</p>
			{/if}
		{:else}
			<p class="text-sm text-zinc-400">El recorrido no se enseña: todo él queda cerca de casa.</p>
		{/if}
		{#if w.photos.length}
			<div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
				{#each w.photos as p (p.id)}
					<button onclick={() => (shown = p.id)} class="block">
						<img
							src="{base}/{p.id}"
							alt="Foto del paseo"
							loading="lazy"
							class="aspect-square w-full rounded object-cover"
						/>
					</button>
				{/each}
			</div>
		{/if}
	{:else}
		<div class="py-16 text-center">
			<h1 class="mb-2 text-2xl font-bold">Este paseo ya no está disponible</h1>
			<p class="text-zinc-400">Quien lo compartió lo ha retirado, o el enlace no es correcto.</p>
		</div>
	{/if}

	<section class="mt-10 rounded-md border border-zinc-800 p-5 text-center">
		<p class="mb-1 font-semibold">Seilide: las cosas de casa, en un solo sitio</p>
		<p class="mb-4 text-sm text-zinc-400">
			La nevera, la agenda, los gastos y los paseos de tu familia, desde el móvil de cada uno.
		</p>
		<a
			href="/#pedir"
			class="inline-block rounded-md bg-amber-500 px-5 py-2.5 font-medium text-zinc-950 hover:bg-amber-400"
		>
			Pedir invitación
		</a>
	</section>
</main>

{#if shown !== null}
	<button
		class="fixed inset-0 z-20 grid place-items-center bg-black/90 p-4"
		aria-label="Cerrar la foto"
		onclick={() => (shown = null)}
	>
		<img src="{base}/{shown}" alt="Foto del paseo" class="max-h-full max-w-full rounded" />
	</button>
{/if}

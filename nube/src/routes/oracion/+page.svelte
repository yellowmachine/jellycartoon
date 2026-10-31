<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { music } from 'comun/music-player.svelte.ts';
	import { prayerQueue, STATUS_LABEL, type PrayerView } from '#lib/prayers.ts';
	import { primary, secondary } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** A child only listens (kids.ts): nothing to change. */
	const kid = $derived(page.data.family?.kid ?? false);
	const byId = $derived(new Map(data.prayers.map((p) => [p.id, p])));
	let notice = $state<string | null>(null);

	// While a voice is being made, how it goes, every few seconds.
	$effect(() => {
		if (!data.prayers.some((p) => p.status === 'generando')) return;
		const timer = setInterval(() => void invalidateAll(), 4000);
		return () => clearInterval(timer);
	});

	function pray(list: (typeof data.lists)[number]) {
		const { tracks, missing } = prayerQueue(list, data.prayers);
		notice = missing
			? `${missing === 1 ? 'Un texto no tiene' : `${missing} textos no tienen`} voz todavía: se salta${missing === 1 ? '' : 'n'}.`
			: null;
		if (tracks.length) music.play(tracks);
	}

	function listen(p: PrayerView) {
		notice = null;
		const one = { id: 0, title: p.title, pauseSec: 0, items: [{ prayerId: p.id, times: 1 }] };
		const { tracks } = prayerQueue(one, [p]);
		if (tracks.length) music.play(tracks);
	}

	const minutes = (sec: number | null) =>
		sec == null ? '' : sec < 60 ? `${Math.round(sec)} s` : `${Math.round(sec / 60)} min`;

	const listLength = (list: (typeof data.lists)[number]) =>
		list.items.reduce((n, i) => n + (byId.get(i.prayerId)?.durationSec ?? 0) * i.times, 0) +
		Math.max(list.items.reduce((n, i) => n + i.times, 0) - 1, 0) * list.pauseSec;

	const statusColor: Record<PrayerView['status'], string> = {
		pendiente: 'text-zinc-500',
		generando: 'text-amber-400',
		lista: 'text-emerald-400',
		cambiada: 'text-amber-400',
		error: 'text-red-400'
	};
</script>

<svelte:head>
	<title>Oración · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-4 text-2xl font-bold">Oración</h1>

	{#if notice}
		<p class="mb-4 text-sm text-amber-400">{notice}</p>
	{/if}
	{#if form && 'problem' in form}
		<p class="mb-4 text-sm text-red-400">{form.problem}</p>
	{/if}

	<div class="mb-2 flex items-center justify-between gap-3">
		<h2 class="font-semibold text-amber-400">Listas</h2>
		{#if !kid}<a href="/oracion/lista/nueva" class={secondary}>+ Lista</a>{/if}
	</div>
	<ul class="mb-8 divide-y divide-zinc-800">
		{#each data.lists as list (list.id)}
			<li class="flex items-center gap-3 py-2">
				<button
					class="{primary} shrink-0"
					disabled={!list.items.length}
					onclick={() => pray(list)}
					aria-label="Rezar {list.title}">▶</button
				>
				<span class="min-w-0 flex-1">
					<span class="block truncate">{list.title}</span>
					<span class="block text-xs text-zinc-500"
						>{list.items.length}
						{list.items.length === 1 ? 'texto' : 'textos'}{#if listLength(list)}
							· {minutes(listLength(list))}{/if}</span
					>
				</span>
				{#if !kid}<a href="/oracion/lista/{list.id}" class="text-sm text-zinc-400 hover:underline"
						>Editar</a
					>{/if}
			</li>
		{:else}
			<li class="py-2 text-sm text-zinc-600">
				Ninguna todavía.{#if !kid}
					Una lista encadena textos, cada uno las veces que digas (un Ave María, diez).{/if}
			</li>
		{/each}
	</ul>

	<div class="mb-2 flex items-center justify-between gap-3">
		<h2 class="font-semibold text-amber-400">Textos</h2>
		{#if !kid}
			<span class="flex gap-2">
				<a href="/oracion/voces" class={secondary}>Voces</a>
				<a href="/oracion/texto/nuevo" class={secondary}>+ Texto</a>
			</span>
		{/if}
	</div>
	<ul class="mb-8 divide-y divide-zinc-800">
		{#each data.prayers as p (p.id)}
			<li class="flex items-center gap-3 py-2">
				<button
					class="{secondary} shrink-0"
					disabled={!p.audioUrl}
					onclick={() => listen(p)}
					aria-label="Escuchar {p.title}">▶</button
				>
				<span class="min-w-0 flex-1">
					<span class="block truncate">{p.title}</span>
					<span class="block text-xs {statusColor[p.status]}"
						>{STATUS_LABEL[p.status]}{#if p.durationSec && p.status !== 'generando'}
							<span class="text-zinc-500"> · {minutes(p.durationSec)}</span>{/if}</span
					>
					{#if p.error}<span class="block text-xs text-red-400">{p.error}</span>{/if}
				</span>
				{#if !kid}
					{#if p.status === 'pendiente' || p.status === 'cambiada' || p.status === 'error'}
						<form method="post" action="?/generate" use:enhance>
							<input type="hidden" name="id" value={p.id} />
							<button class="text-sm text-amber-400 hover:underline"
								>{p.status === 'pendiente' ? 'Generar' : 'Regenerar'}</button
							>
						</form>
					{/if}
					<a href="/oracion/texto/{p.id}" class="text-sm text-zinc-400 hover:underline">Editar</a>
				{/if}
			</li>
		{:else}
			<li class="py-2 text-sm text-zinc-600">
				Ninguno todavía.{#if !kid}
					Pega una oración o una letanía (de vatican.va, por ejemplo) y dale voz.{/if}
			</li>
		{/each}
	</ul>
</div>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { music } from 'comun/music-player.svelte.ts';
	import { prayerQueue, STATUS_LABEL, type HouseNow, type PrayerView } from '#lib/prayers.ts';
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

	// ——— The whole house (Snapcast) ———

	/** What it plays of Oración, as last asked; why it did not answer. */
	let houseNow = $state<HouseNow | null>(null);
	let houseProblem = $state<string | null>(null);
	/** Asked again now (after a button), instead of at its next turn. */
	let askHouseNow = $state(0);

	async function askHouse() {
		const res = await fetch('/api/oracion/casa').catch(() => null);
		const body = res?.ok ? await res.json() : null;
		houseNow = body?.now ?? null;
		houseProblem = body ? body.problem : 'Sin conexión con Seilide';
	}

	// While the page is open: every few seconds while it plays there, less often while it does not.
	$effect(() => {
		if (!data.house) return;
		void askHouseNow;
		let timer: ReturnType<typeof setTimeout>;
		let gone = false;
		const tick = async () => {
			if (document.visibilityState === 'visible') await askHouse();
			if (!gone) timer = setTimeout(tick, houseNow ? 3000 : 15_000);
		};
		void tick();
		return () => {
			gone = true;
			clearTimeout(timer);
		};
	});

	/** After a button: what it plays, at once. */
	const fromHouse =
		() =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			askHouseNow++;
		};

	const clock = (sec: number | null) =>
		sec == null ? '' : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

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
	{:else if form && 'inHouse' in form && form.missing}
		<p class="mb-4 text-sm text-amber-400">
			{form.missing === 1 ? 'Un texto no tiene' : `${form.missing} textos no tienen`} voz todavía: se
			salta{form.missing === 1 ? '' : 'n'}.
		</p>
	{/if}

	{#if houseNow}
		<section class="mb-6 rounded-md border border-amber-500/40 bg-zinc-900 p-3">
			<p class="text-xs text-zinc-400">Sonando en toda la casa</p>
			<p class="truncate">{houseNow.title}</p>
			<p class="mb-2 truncate text-xs text-zinc-500">
				{houseNow.album}{#if houseNow.durationSec}
					· {clock(houseNow.positionSec)} / {clock(houseNow.durationSec)}{/if}
			</p>
			<form method="post" action="?/houseControl" use:enhance={fromHouse} class="flex gap-2">
				<button name="do" value="previous" class={secondary} aria-label="Anterior">⏮</button>
				<button
					name="do"
					value={houseNow.paused ? 'resume' : 'pause'}
					class={primary}
					aria-label={houseNow.paused ? 'Seguir' : 'Pausa'}>{houseNow.paused ? '▶' : '⏸'}</button
				>
				<button
					name="do"
					value="next"
					class={secondary}
					disabled={houseNow.last}
					aria-label="Siguiente">⏭</button
				>
				<button name="do" value="stop" class={secondary} aria-label="Parar">■</button>
			</form>
		</section>
	{:else if houseProblem && data.house}
		<p class="mb-4 text-xs text-zinc-500">Casa: {houseProblem}</p>
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
				{#if data.house && list.items.length}
					<form method="post" action="?/house" use:enhance={fromHouse}>
						<input type="hidden" name="id" value={list.id} />
						<button class="text-sm text-amber-400 hover:underline" title="Por Snapcast"
							>▶ En toda la casa</button
						>
					</form>
				{/if}
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

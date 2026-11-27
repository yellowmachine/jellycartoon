<script lang="ts">
	import { signedSwitch } from '#lib/enchufes/firma.ts';
	import '@fontsource/comic-neue/400.css';
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { dayName, localDay, localTime } from 'comun/agenda.ts';
	import { doseText, groupDoses, markValue } from 'comun/medication.ts';
	import { PAPERS, tiltFor, type FridgeState } from 'comun/fridge.ts';
	import { skyIcon } from 'comun/weather.ts';
	import { upFirst } from '#lib/planned-trips.ts';
	import { sectionOn } from '#lib/nav.ts';
	import { PLUG_KINDS, powerText, type PlugView } from '#lib/plugs.ts';
	import { todayLines } from '#lib/today-lines.ts';
	import { vista } from '#lib/vista.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * The Vista's home (#525), on the right of its screen: today in the house, big, to read from
	 * across the room and touch with a finger. Who does not answer in «Compañía» first; then the
	 * clock and the weather, today's agenda with the house's alarms, the doses still to take, the
	 * fridge and the plugs. Each card, only if the family has its section out (Ajustes). Locked
	 * (#532), without the links to those sections: nothing leaves the Vista.
	 */
	let { data }: PageProps = $props();

	onMount(() => {
		vista.load();
		if (!vista.on) void vista.set(true);
	});

	const shows = (path: string) => sectionOn(path, data.family?.sections);

	let now = $state(new Date());
	onMount(() => {
		const tick = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(tick);
	});

	// What the others change, here at once (SSE), as on the home page.
	let fridge = $derived<FridgeState>(data.vista.fridge);
	$effect(() => {
		const events = new EventSource('/api/nevera/events');
		events.onmessage = (e) => (fridge = JSON.parse(e.data));
		return () => events.close();
	});
	let livePlugs = $state<PlugView[] | null>(null);
	const plugs = $derived((livePlugs ?? data.vista.plugs).filter((p) => !p.waiting));
	$effect(() => {
		if (!data.vista.plugs.length) return;
		const events = new EventSource('/api/enchufes/events');
		events.onmessage = (e) => (livePlugs = JSON.parse(e.data));
		return () => events.close();
	});

	const lines = $derived(todayLines(fridge.today, data.vista.alarms, now));
	const nameOf = (id: string) => fridge.today.people.find((p) => p.id === id)?.name ?? null;
	const toBuy = $derived(fridge.list.items.filter((i) => !i.done));
	const timeOf = (d: Date | string) =>
		new Date(d).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

	/** The plug being sent an order, and why the last one could not be. */
	let switching = $state<string | null>(null);
	let plugProblem = $state<string | null>(null);
	/** Why the last dose could not be marked. */
	let doseProblem = $state<string | null>(null);

	const card = 'rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5';
	const cardTitle = 'mb-4 flex items-baseline justify-between text-2xl font-semibold';
</script>

<svelte:head>
	<title>Vista · Seilide</title>
</svelte:head>

{#each data.vista.alerts as c (c.familyId)}
	<!-- Locked (#532): only the warning, no way to Compañía. -->
	<svelte:element
		this={vista.locked ? 'div' : 'a'}
		href={vista.locked ? undefined : '/compania'}
		class="mb-6 flex items-center gap-4 rounded-2xl border border-red-700/70 bg-gradient-to-r from-red-500/25 to-transparent p-5 hover:border-red-400"
	>
		<span class="text-5xl" aria-hidden="true">⚠️</span>
		<div class="min-w-0">
			<p class="text-2xl font-semibold text-red-300">{c.name}</p>
			<p class="text-lg text-zinc-300">
				{c.alert?.kind === 'silent'
					? `No contesta desde las ${timeOf(c.alert.since)}`
					: 'Su satélite no responde'}
			</p>
		</div>
	</svelte:element>
{/each}

<header class="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
	<div>
		<p class="text-7xl font-bold tabular-nums">{localTime(now)}</p>
		<p class="text-2xl text-zinc-400">{upFirst(dayName(localDay(now), true))}</p>
	</div>
	{#await data.vista.weather then w}
		{#if w}
			<div class="text-right" title={w.place}>
				<p class="text-5xl">
					<span aria-hidden="true">{skyIcon(w.code)}</span>
					{w.temperature} °C
				</p>
				<p class="text-xl text-zinc-400">
					{w.min}–{w.max} °C{w.rain >= 30 ? ` · lluvia ${w.rain} %` : ''}
				</p>
			</div>
		{/if}
	{/await}
</header>

<div class="grid gap-6 2xl:grid-cols-2">
	{#if shows('/agenda')}
		<section class={card}>
			<h2 class={cardTitle}>
				Hoy {#if !vista.locked}<a href="/agenda" class="text-base font-normal text-amber-400"
						>Agenda</a
					>{/if}
			</h2>
			{#if lines.length}
				<ul class="flex flex-col gap-3 text-xl">
					{#each lines as l (l.key)}
						<li class={['flex gap-4', l.over && 'text-zinc-500']}>
							<span
								class={[
									'w-28 shrink-0 tabular-nums',
									l.ringing ? 'font-semibold text-amber-400' : 'text-zinc-400'
								]}>{l.time}</span
							>
							<span class="min-w-0 flex-1"
								>{l.title}{#if l.who}<span class="text-base text-zinc-500">
										· {l.who}</span
									>{/if}</span
							>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-xl text-zinc-400">Nada para hoy.</p>
			{/if}
		</section>
	{/if}

	{#if data.vista.doses.length}
		<section class={card}>
			<h2 class={cardTitle}>
				Tomas de hoy
				{#if !vista.locked}<a href="/agenda/medicacion" class="text-base font-normal text-amber-400"
						>Medicación</a
					>{/if}
			</h2>
			<ul class="flex flex-col gap-3">
				{#each groupDoses(data.vista.doses) as g (`${g.time}-${g.personId}`)}
					{@const late = g.time <= localTime(now)}
					<li>
						<form
							method="post"
							action="/agenda/medicacion?/mark"
							use:enhance={() => {
								doseProblem = null;
								// Another route's action: `update()` would go there (Kit 3), out of the Vista.
								return async ({ result }) => {
									if (result.type === 'success') await refreshAll();
									else doseProblem = 'No se pudo marcar: prueba otra vez.';
								};
							}}
							class="flex items-center gap-4 text-xl"
						>
							<input type="hidden" name="day" value={g.day} />
							<input type="hidden" name="time" value={g.time} />
							<span
								class={[
									'w-16 shrink-0 tabular-nums',
									late ? 'font-semibold text-amber-400' : 'text-zinc-400'
								]}>{g.time}</span
							>
							<span class="min-w-0 flex-1"
								>{g.doses.map(doseText).join(' · ')}{#if nameOf(g.personId)}<span
										class="text-base text-zinc-500"
									>
										· {nameOf(g.personId)}</span
									>{/if}</span
							>
							<button
								name="mark"
								value={markValue(
									g.doses.map((d) => d.medicationId),
									true
								)}
								class="shrink-0 rounded-xl bg-amber-500 px-5 py-3 text-lg font-semibold text-zinc-950 active:scale-95"
								title="Marcar como {g.doses.length > 1 ? 'tomadas' : 'tomada'}">Tomar</button
							>
						</form>
					</li>
				{/each}
			</ul>
			{#if doseProblem}
				<p class="mt-3 text-lg text-red-400">{doseProblem}</p>
			{/if}
		</section>
	{/if}

	{#if shows('/nevera')}
		<section class={card}>
			<h2 class={cardTitle}>
				En la nevera {#if !vista.locked}<a
						href="/nevera"
						class="text-base font-normal text-amber-400">Nevera</a
					>{/if}
			</h2>
			{#if fridge.notes.length}
				<ul class="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
					{#each fridge.notes as note (note.id)}
						{@const paper = PAPERS[note.author?.paper ?? 0]}
						<li
							class="paper hand line-clamp-5 text-xl leading-snug break-words"
							style="--bg: {paper.bg}; --ink: {paper.ink}; transform: rotate({tiltFor(note.id)}deg)"
						>
							{note.text}
						</li>
					{/each}
				</ul>
			{/if}
			<svelte:element
				this={vista.locked ? 'p' : 'a'}
				href={vista.locked ? undefined : '/nevera'}
				class={['block text-xl', !vista.locked && 'hover:underline']}
			>
				🛒 {toBuy.length
					? `Compra: ${toBuy
							.slice(0, 4)
							.map((i) => i.text)
							.join(', ')}${toBuy.length > 4 ? ` y ${toBuy.length - 4} más` : ''}`
					: 'La compra está vacía'}
			</svelte:element>
		</section>
	{/if}

	{#if plugs.length && shows('/enchufes')}
		<section class={card}>
			<h2 class={cardTitle}>
				Enchufes {#if !vista.locked}<a href="/enchufes" class="text-base font-normal text-amber-400"
						>Consumo</a
					>{/if}
			</h2>
			<ul class="grid grid-cols-2 gap-3">
				{#each plugs as p (p.id)}
					{@const on = p.output === true}
					<li>
						<form
							method="post"
							action="/enchufes?/switch"
							use:enhance={async ({ formData }) => {
								switching = p.id;
								// Through its satellite (#643): signed here, if this tablet is given to it.
								const signed = await signedSwitch(p, !on);
								if (signed) formData.set('signed', signed);
								plugProblem = null;
								// Another route's action: no `update()`, which would go there (Kit 3); the
								// plug's new state comes by its events.
								return async ({ result }) => {
									switching = null;
									if (result.type === 'failure')
										plugProblem = String(result.data?.problem ?? 'No se pudo');
									else if (result.type === 'error') plugProblem = 'No se pudo';
								};
							}}
						>
							<input type="hidden" name="id" value={p.id} />
							<input type="hidden" name="on" value={String(!on)} />
							<button
								disabled={!p.online || p.locked || p.paused || switching === p.id}
								aria-pressed={on}
								class={[
									'flex w-full items-center gap-3 rounded-xl border p-4 text-left text-lg active:scale-95 disabled:opacity-50',
									on
										? 'border-amber-500 bg-amber-500/15 text-amber-200'
										: 'border-zinc-700 bg-zinc-900 text-zinc-300'
								]}
							>
								<span class="text-3xl" aria-hidden="true">{PLUG_KINDS[p.kind].icon}</span>
								<span class="min-w-0 flex-1">
									<span class="block truncate font-semibold">{p.name}</span>
									<span class="block text-sm text-zinc-400">
										{#if !p.online}
											Sin conexión
										{:else if p.locked}
											🔒 {on ? 'Encendido' : 'Apagado'}
										{:else if on}
											Encendido{p.power ? ` · ${powerText(p.power)}` : ''}
										{:else}
											Apagado
										{/if}
									</span>
								</span>
							</button>
						</form>
					</li>
				{/each}
			</ul>
			{#if plugProblem}
				<p class="mt-3 text-lg text-red-400">{plugProblem}</p>
			{/if}
		</section>
	{/if}
</div>

<style>
	.paper {
		background: var(--bg);
		color: var(--ink);
		padding: 0.75rem;
		min-height: 6rem;
		box-shadow:
			0 10px 16px -8px #0009,
			0 2px 3px #0004;
		border-radius: 2px;
	}
	.hand {
		font-family: 'Comic Neue', cursive;
	}
</style>

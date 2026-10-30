<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { dayName, WEEKDAYS } from 'comun/agenda.ts';
	import { daysText, MAX_DOSE, MAX_NAME, MAX_TIMES, type Medication } from 'comun/medication.ts';
	import AgendaTabs from '#lib/components/AgendaTabs.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Marked from a notice while the page was in the background: seen on coming back.
	onMount(() => {
		const back = () => {
			if (document.visibilityState === 'visible') void invalidateAll();
		};
		document.addEventListener('visibilitychange', back);
		return () => document.removeEventListener('visibilitychange', back);
	});

	const person = (id: string) => data.people.find((p) => p.id === id);

	// ——— Adding one, or changing it ———

	interface Editing {
		id: number | null;
		personId: string;
		name: string;
		dose: string;
		times: string[];
		days: number[];
		startDay: string;
		ends: boolean;
		endDay: string;
	}

	let editing = $state<Editing | null>(null);
	let problem = $state<string | null>(null);
	let saving = $state(false);
	let deleting = $state(false);
	let editor = $state<HTMLElement>();

	async function open(e: Editing) {
		editing = e;
		problem = null;
		deleting = false;
		await tick();
		editor?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function fresh() {
		void open({
			id: null,
			personId: data.person ?? data.me ?? data.people[0]?.id ?? '',
			name: '',
			dose: '',
			times: ['08:00'],
			days: [],
			startDay: data.today,
			ends: false,
			endDay: data.today
		});
	}

	function change(m: Medication) {
		void open({
			id: m.id,
			personId: m.personId,
			name: m.name,
			dose: m.dose ?? '',
			times: [...m.times],
			days: [...m.days],
			startDay: m.startDay,
			ends: Boolean(m.endDay),
			endDay: m.endDay ?? data.today
		});
	}

	/** As the server takes it. */
	const asInput = $derived.by(() => {
		const e = editing;
		if (!e) return null;
		return {
			personId: e.personId,
			name: e.name,
			dose: e.dose,
			times: e.times,
			days: e.days,
			startDay: e.startDay,
			endDay: e.ends ? e.endDay : null
		};
	});

	function toggle<T>(list: T[], value: T) {
		const at = list.indexOf(value);
		if (at >= 0) list.splice(at, 1);
		else list.push(value);
	}

	const href = (id: string | null) => (id ? `?persona=${id}` : '?');

	const field =
		'rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500';
	const button = 'rounded-md px-3 py-1.5 text-sm disabled:opacity-40';
	const chip = (on: boolean) =>
		[
			'rounded-full border px-3 py-1 text-sm',
			on ? 'border-amber-500 text-amber-300' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
		].join(' ');
</script>

{#snippet badge(id: string, size = 'h-6 w-6 text-sm')}
	{@const p = person(id)}
	{#if p}
		<span
			title={p.name}
			class="flex shrink-0 items-center justify-center rounded-full {size} {p.color ??
				'bg-zinc-600'}">{p.emoji ?? p.name.slice(0, 1)}</span
		>
	{/if}
{/snippet}

<svelte:head>
	<title>Medicación · Agenda · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-3 text-2xl font-bold">Agenda</h1>
	<AgendaTabs current="medicacion" />
	<p class="mb-4 text-sm text-zinc-400">
		Las tomas de cada uno. A su hora llega un aviso al móvil con «✓ Tomada»: el tuyo a tu móvil, el
		de un peque a los de sus adultos.
	</p>

	<div class="mb-4 flex flex-wrap gap-2">
		<a href={href(null)} class={chip(data.person === null)}>Todos</a>
		{#each data.people as p (p.id)}
			<a href={href(p.id)} class="{chip(data.person === p.id)} flex items-center gap-1.5">
				{@render badge(p.id, 'h-5 w-5 text-xs')}
				{p.name}
			</a>
		{/each}
	</div>

	<h2 class="mb-2 font-semibold text-amber-400 first-letter:uppercase">
		Hoy, {dayName(data.today)}
	</h2>
	<ul class="mb-8 divide-y divide-zinc-800">
		{#each data.doses as d (`${d.medicationId}-${d.time}`)}
			<li class="flex items-center gap-3 py-2">
				<span class="w-12 shrink-0 text-sm text-zinc-400 tabular-nums">{d.time}</span>
				{@render badge(d.personId)}
				<span class="min-w-0 flex-1">
					<span class="block truncate">{d.name}</span>
					{#if d.dose}<span class="block truncate text-xs text-zinc-500">{d.dose}</span>{/if}
				</span>
				<form method="post" action="?/mark" use:enhance>
					<input type="hidden" name="id" value={d.medicationId} />
					<input type="hidden" name="day" value={d.day} />
					<input type="hidden" name="time" value={d.time} />
					{#if d.takenAt}
						<input type="hidden" name="taken" value="0" />
						<button
							class="{button} text-emerald-400 hover:bg-zinc-800"
							title="Tocar para desmarcarla"
							>✓ {d.takenAt}{d.takenBy ? ` · ${d.takenBy}` : ''}</button
						>
					{:else}
						<input type="hidden" name="taken" value="1" />
						<button class="{button} bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400"
							>Tomada</button
						>
					{/if}
				</form>
			</li>
		{:else}
			<li class="py-2 text-sm text-zinc-600">Nada que tomar hoy.</li>
		{/each}
	</ul>

	<button
		class="mb-6 rounded-md bg-amber-500 px-4 py-2 font-semibold text-zinc-950 hover:bg-amber-400"
		onclick={fresh}>+ Añadir</button
	>

	{#if editing}
		{@const e = editing}
		<section
			bind:this={editor}
			class="mb-8 scroll-mt-20 rounded-lg border border-zinc-700 bg-zinc-900 p-4"
		>
			<h2 class="mb-3 font-semibold">{e.id ? 'Cambiar' : 'Añadir'}</h2>
			<div class="flex flex-col gap-4">
				<div>
					<p class="mb-1 text-xs text-zinc-400">Para quién</p>
					<div class="flex flex-wrap gap-2">
						{#each data.people as p (p.id)}
							<button
								type="button"
								class="{chip(e.personId === p.id)} flex items-center gap-1.5"
								aria-pressed={e.personId === p.id}
								onclick={() => (e.personId = p.id)}
							>
								{@render badge(p.id, 'h-5 w-5 text-xs')}
								{p.name}
							</button>
						{/each}
					</div>
				</div>

				<div class="flex flex-wrap gap-3">
					<label class="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-400">
						Qué
						<!-- svelte-ignore a11y_autofocus -->
						<input
							bind:value={e.name}
							maxlength={MAX_NAME}
							class={field}
							placeholder="Sintrom, Dalsy, Omeprazol…"
							autofocus={!e.id}
						/>
					</label>
					<label class="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-400">
						Cuánto (si hace falta)
						<input
							bind:value={e.dose}
							maxlength={MAX_DOSE}
							class={field}
							placeholder="½ pastilla, 5 ml…"
						/>
					</label>
				</div>

				<div>
					<p class="mb-1 text-xs text-zinc-400">A las</p>
					<div class="flex flex-wrap items-center gap-2">
						{#each e.times as _, i (i)}
							<span class="flex items-center">
								<input type="time" bind:value={e.times[i]} required class={field} />
								{#if e.times.length > 1}
									<button
										type="button"
										class="rounded px-2 text-zinc-500 hover:bg-zinc-800 hover:text-white"
										aria-label="Quitar esta hora"
										onclick={() => e.times.splice(i, 1)}>✕</button
									>
								{/if}
							</span>
						{/each}
						{#if e.times.length < MAX_TIMES}
							<button type="button" class={chip(false)} onclick={() => e.times.push('')}
								>+ Otra hora</button
							>
						{/if}
					</div>
				</div>

				<div>
					<p class="mb-1 text-xs text-zinc-400">Qué días</p>
					<div class="flex flex-wrap gap-1">
						<button
							type="button"
							class="{chip(e.days.length === 0)} mr-2"
							onclick={() => (e.days = [])}>Todos</button
						>
						{#each WEEKDAYS as w, i (w)}
							<button
								type="button"
								class="{chip(e.days.includes(i))} w-9 px-0"
								aria-pressed={e.days.includes(i)}
								onclick={() => toggle(e.days, i)}>{w}</button
							>
						{/each}
					</div>
				</div>

				<div class="flex flex-wrap items-end gap-3">
					<label class="flex flex-col gap-1 text-xs text-zinc-400">
						Desde
						<input type="date" bind:value={e.startDay} class={field} />
					</label>
					<label class="flex items-center gap-2 pb-2 text-sm">
						<input type="checkbox" bind:checked={e.ends} class="rounded" /> Acaba
					</label>
					{#if e.ends}
						<label class="flex flex-col gap-1 text-xs text-zinc-400">
							Hasta el día
							<input type="date" bind:value={e.endDay} min={e.startDay} class={field} />
						</label>
					{/if}
				</div>

				<form
					method="post"
					action="?/save"
					class="flex flex-wrap items-center gap-2"
					use:enhance={({ cancel }) => {
						if (!e.name.trim()) {
							problem = 'Falta qué es';
							return cancel();
						}
						saving = true;
						return async ({ result, update }) => {
							saving = false;
							if (result.type === 'success') editing = null;
							else if (result.type === 'failure')
								problem = String(result.data?.message ?? 'No se pudo guardar');
							await update({ reset: false });
						};
					}}
				>
					{#if e.id}<input type="hidden" name="id" value={e.id} />{/if}
					<input type="hidden" name="medication" value={JSON.stringify(asInput)} />
					<button
						class="{button} bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400"
						disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button
					>
					<button type="button" class="{button} hover:bg-zinc-800" onclick={() => (editing = null)}
						>Cancelar</button
					>
					{#if problem}<span class="text-sm text-red-400">{problem}</span>{/if}
				</form>

				{#if e.id}
					<div class="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
						{#if deleting}
							<form
								method="post"
								action="?/delete"
								class="flex items-center gap-2"
								use:enhance={() =>
									async ({ update }) => {
										editing = null;
										await update();
									}}
							>
								<input type="hidden" name="id" value={e.id} />
								<span class="text-sm">¿Quitarlo?</span>
								<button class="{button} bg-red-700 hover:bg-red-600">Sí</button>
								<button
									type="button"
									class="{button} hover:bg-zinc-800"
									onclick={() => (deleting = false)}>No</button
								>
							</form>
						{:else}
							<button
								class="{button} text-zinc-400 hover:bg-zinc-800"
								onclick={() => (deleting = true)}>Quitar</button
							>
						{/if}
					</div>
				{/if}
			</div>
		</section>
	{/if}

	<h2 class="mb-2 font-semibold">Lo que toma{data.person ? '' : ' cada uno'}</h2>
	<ul class="mb-10 divide-y divide-zinc-800">
		{#each data.meds as m (m.id)}
			<li>
				<button
					type="button"
					class="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-zinc-800"
					onclick={() => change(m)}
				>
					{@render badge(m.personId)}
					<span class="min-w-0 flex-1">
						<span class="block truncate">{m.name}{m.dose ? ` · ${m.dose}` : ''}</span>
						<span class="block truncate text-xs text-zinc-500">
							{m.times.join(', ')} · {daysText(m.days)}{m.endDay
								? ` · hasta el ${dayName(m.endDay)}`
								: ''}{m.startDay > data.today ? ` · desde el ${dayName(m.startDay)}` : ''}
						</span>
					</span>
				</button>
			</li>
		{:else}
			<li class="py-2 text-sm text-zinc-600">Nada apuntado.</li>
		{/each}
	</ul>
</div>

<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import {
		addDays,
		dayEvents,
		daysBetween,
		dayName,
		MAX_NOTES,
		MAX_TITLE,
		repeatText,
		timeOn,
		weekday,
		WEEKDAYS,
		type AgendaEvent,
		type Occurrence,
		type Remind,
		type Repeat
	} from '#lib/agenda.ts';
	import { monthName } from '#lib/expenses.ts';
	import type { PageProps } from './$types';
	import Alarmas from './Alarmas.svelte';

	let { data }: PageProps = $props();

	const person = (id: string) => data.people.find((p) => p.id === id);
	const eventOf = (id: number) => data.events.find((e) => e.id === id);

	// ——— Writing one down, or changing it ———

	interface Editing {
		id: number | null;
		/** The repetition it was opened from: «esta vez no» skips that one. */
		day: string | null;
		title: string;
		notes: string;
		startDay: string;
		allDay: boolean;
		startTime: string;
		endTime: string;
		/** Longer than a day: its last. */
		long: boolean;
		endDay: string;
		every: Repeat['every'];
		days: number[];
		remind: Remind;
		people: string[];
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

	function fresh(day: string) {
		void open({
			id: null,
			day: null,
			title: '',
			notes: '',
			startDay: day,
			allDay: false,
			startTime: '17:00',
			endTime: '',
			long: false,
			endDay: day,
			every: null,
			days: [weekday(day)],
			remind: null,
			people: []
		});
	}

	function change(e: AgendaEvent, day: string) {
		void open({
			id: e.id,
			day,
			title: e.title,
			notes: e.notes ?? '',
			startDay: e.startDay,
			allDay: !e.startTime,
			startTime: e.startTime ?? '17:00',
			endTime: e.endTime ?? '',
			long: Boolean(e.endDay),
			endDay: e.endDay ?? e.startDay,
			every: e.repeat.every,
			days: e.repeat.every === 'semana' ? e.repeat.days : [weekday(e.startDay)],
			remind: e.remind,
			people: [...e.people]
		});
	}

	/** As the server takes it. */
	const asInput = $derived.by(() => {
		const e = editing;
		if (!e) return null;
		const repeat: Repeat =
			e.every === 'semana' ? { every: 'semana', days: e.days } : ({ every: e.every } as Repeat);
		return {
			title: e.title,
			notes: e.notes,
			startDay: e.startDay,
			startTime: e.allDay ? null : e.startTime,
			endDay: e.long ? e.endDay : null,
			endTime: e.allDay ? null : e.endTime || null,
			repeat,
			remind: e.allDay && e.remind === 'hora' ? null : e.remind,
			people: e.people
		};
	});

	function toggle<T>(list: T[], value: T) {
		const at = list.indexOf(value);
		if (at >= 0) list.splice(at, 1);
		else list.push(value);
	}

	const REPEATS: { every: Repeat['every']; label: string }[] = [
		{ every: null, label: 'No se repite' },
		{ every: 'semana', label: 'Cada semana' },
		{ every: 'mes', label: 'Cada mes' },
		{ every: 'año', label: 'Cada año' }
	];
	const REMINDS: { remind: Remind; label: string }[] = [
		{ remind: null, label: 'Sin aviso' },
		{ remind: 'hora', label: '1 hora antes' },
		{ remind: 'dia', label: 'El día antes' }
	];

	// ——— What is shown ———

	const days = $derived(
		Array.from({ length: daysBetween(data.from, data.to) + 1 }, (_, i) => addDays(data.from, i))
	);
	const week = $derived(data.view === 'semana' ? days : []);
	/** The month's: the days of the month looked at, the others greyed. */
	const month = $derived(data.day.slice(0, 7));

	const step = $derived(
		data.view === 'mes'
			? {
					back: addDays(`${month}-01`, -1).slice(0, 8) + '01',
					next: addDays(`${month}-28`, 4).slice(0, 8) + '01'
				}
			: { back: addDays(data.from, -7), next: addDays(data.from, 7) }
	);
	const href = (day: string, view = data.view) =>
		`?dia=${day}${view === 'mes' ? '&vista=mes' : ''}`;

	/** «26 oct.» */
	const short = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});
	const title = $derived(
		data.view === 'mes' ? monthName(month) : `${short(data.from)} – ${short(data.to)}`
	);

	let copied = $state(false);
	async function copy(text: string) {
		await navigator.clipboard.writeText(text).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	const field =
		'rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500';
	const button = 'rounded-md px-3 py-1.5 text-sm disabled:opacity-40';
	const chip = (on: boolean) =>
		[
			'rounded-full border px-3 py-1 text-sm',
			on ? 'border-amber-500 text-amber-300' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
		].join(' ');
</script>

{#snippet badges(ids: string[], size = 'h-6 w-6 text-sm')}
	<span class="flex shrink-0 -space-x-1">
		{#each ids as id (id)}
			{@const p = person(id)}
			{#if p}
				<span
					title={p.name}
					class="flex items-center justify-center rounded-full ring-2 ring-zinc-950 {size} {p.color ??
						'bg-zinc-600'}">{p.emoji ?? p.name.slice(0, 1)}</span
				>
			{/if}
		{/each}
	</span>
{/snippet}

{#snippet occurrence(o: Occurrence, day: string)}
	{@const e = eventOf(o.eventId)}
	{@const detail = [
		o.day !== o.lastDay && day === o.day ? `Hasta el ${dayName(o.lastDay)}` : '',
		e?.notes ?? ''
	]
		.filter(Boolean)
		.join(' · ')}
	{#snippet inside()}
		<span class="w-24 shrink-0 text-sm text-zinc-400 tabular-nums">{timeOn(o, day)}</span>
		<span class="min-w-0 flex-1">
			<span class="block truncate">{o.title}{o.repeats ? ' 🔁' : ''}</span>
			{#if detail}<span class="block truncate text-xs text-zinc-500">{detail}</span>{/if}
		</span>
		{@render badges(o.people)}
	{/snippet}
	{#if data.readonly || !e}
		<div class="flex items-center gap-3 px-2 py-1.5">{@render inside()}</div>
	{:else}
		<button
			type="button"
			class="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-zinc-800"
			onclick={() => change(e, o.day)}>{@render inside()}</button
		>
	{/if}
{/snippet}

{#snippet dayList(day: string)}
	{@const list = dayEvents(data.occurrences, day)}
	<li class="py-2">
		<div class="mb-1 flex items-center gap-2">
			<h3
				class={[
					'text-sm font-semibold first-letter:uppercase',
					day === data.today ? 'text-amber-400' : 'text-zinc-300'
				]}
			>
				{day === data.today ? 'Hoy, ' : ''}{dayName(day, data.view === 'mes')}
			</h3>
			{#if !data.readonly}
				<button
					class="ml-auto rounded px-2 text-zinc-500 hover:bg-zinc-800 hover:text-white"
					aria-label="Apuntar algo el {dayName(day)}"
					onclick={() => fresh(day)}>+</button
				>
			{/if}
		</div>
		{#each list as o (`${o.eventId}-${o.day}`)}
			{@render occurrence(o, day)}
		{:else}
			<p class="px-2 text-sm text-zinc-600">Nada.</p>
		{/each}
	</li>
{/snippet}

<svelte:head>
	<title>Agenda · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-1 text-2xl font-bold">Agenda</h1>
	<p class="mb-4 text-sm text-zinc-400">
		{#if data.readonly}
			Lo que tienes apuntado.
		{:else}
			La de la casa, para todos. Lo de hoy sale en la nevera y en la tele del salón. También por
			voz: «apunta el dentista de Lucía el jueves a las cinco», «¿qué tenemos mañana?».
		{/if}
	</p>

	{#if !data.readonly}
		<button
			class="mb-6 rounded-md bg-amber-500 px-4 py-2 font-semibold text-zinc-950 hover:bg-amber-400"
			onclick={() => fresh(data.day < data.from || data.day > data.to ? data.from : data.day)}
			>+ Apuntar</button
		>
	{/if}

	{#if editing}
		{@const e = editing}
		<section
			bind:this={editor}
			class="mb-8 scroll-mt-20 rounded-lg border border-zinc-700 bg-zinc-900 p-4"
		>
			<h2 class="mb-3 font-semibold">{e.id ? 'Cambiar' : 'Apuntar'}</h2>
			<div class="flex flex-col gap-4">
				<label class="flex flex-col gap-1 text-xs text-zinc-400">
					Qué
					<!-- svelte-ignore a11y_autofocus -->
					<input
						bind:value={e.title}
						maxlength={MAX_TITLE}
						class={field}
						placeholder="Dentista, cumpleaños de Lucía, inglés…"
						autofocus={!e.id}
					/>
				</label>

				<div class="flex flex-wrap items-end gap-3">
					<label class="flex flex-col gap-1 text-xs text-zinc-400">
						{e.long ? 'Desde el día' : 'Día'}
						<input type="date" bind:value={e.startDay} class={field} />
					</label>
					{#if e.long}
						<label class="flex flex-col gap-1 text-xs text-zinc-400">
							Hasta el día
							<input type="date" bind:value={e.endDay} min={e.startDay} class={field} />
						</label>
					{/if}
					{#if !e.allDay}
						<label class="flex flex-col gap-1 text-xs text-zinc-400">
							A las
							<input type="time" bind:value={e.startTime} required class={field} />
						</label>
						<label class="flex flex-col gap-1 text-xs text-zinc-400">
							Hasta las (si se sabe)
							<input type="time" bind:value={e.endTime} class={field} />
						</label>
					{/if}
				</div>
				<div class="flex flex-wrap gap-4 text-sm">
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={e.allDay} class="rounded" /> Todo el día
					</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={e.long} class="rounded" /> Varios días
					</label>
				</div>

				<div>
					<p class="mb-1 text-xs text-zinc-400">Para quién</p>
					<div class="flex flex-wrap gap-2">
						{#each data.people as p (p.id)}
							<button
								type="button"
								class="{chip(e.people.includes(p.id))} flex items-center gap-1.5"
								aria-pressed={e.people.includes(p.id)}
								onclick={() => toggle(e.people, p.id)}
							>
								{@render badges([p.id], 'h-5 w-5 text-xs')}
								{p.name}
							</button>
						{/each}
					</div>
				</div>

				<div>
					<p class="mb-1 text-xs text-zinc-400">Se repite</p>
					<div class="flex flex-wrap gap-2">
						{#each REPEATS as r (r.label)}
							<button
								type="button"
								class={chip(e.every === r.every)}
								onclick={() => (e.every = r.every)}>{r.label}</button
							>
						{/each}
					</div>
					{#if e.every === 'semana'}
						<div class="mt-2 flex gap-1">
							{#each WEEKDAYS as w, i (w)}
								<button
									type="button"
									class="{chip(e.days.includes(i))} w-9 px-0"
									aria-pressed={e.days.includes(i)}
									onclick={() => toggle(e.days, i)}>{w}</button
								>
							{/each}
						</div>
					{/if}
				</div>

				<div>
					<p class="mb-1 text-xs text-zinc-400">Aviso al móvil</p>
					<div class="flex flex-wrap gap-2">
						{#each REMINDS as r (r.label)}
							<button
								type="button"
								class={chip(e.remind === r.remind)}
								disabled={r.remind === 'hora' && e.allDay}
								onclick={() => (e.remind = r.remind)}>{r.label}</button
							>
						{/each}
					</div>
					{#if e.remind === 'dia'}
						<p class="mt-1 text-xs text-zinc-500">A las 20:00 del día antes.</p>
					{/if}
				</div>

				<label class="flex flex-col gap-1 text-xs text-zinc-400">
					Notas
					<textarea
						bind:value={e.notes}
						maxlength={MAX_NOTES}
						rows="2"
						class="{field} resize-y"
						placeholder="Llevar la tarjeta sanitaria…"></textarea>
				</label>

				<form
					method="post"
					action="?/save"
					class="flex flex-wrap items-center gap-2"
					use:enhance={({ cancel }) => {
						if (!e.title.trim()) {
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
					<input type="hidden" name="event" value={JSON.stringify(asInput)} />
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
					{@const id = e.id}
					<div class="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
						{#if e.day && eventOf(id)?.repeat.every}
							<form
								method="post"
								action="?/skip"
								use:enhance={() =>
									async ({ update }) => {
										editing = null;
										await update();
									}}
							>
								<input type="hidden" name="id" value={id} />
								<input type="hidden" name="day" value={e.day} />
								<button class="{button} bg-zinc-800 hover:bg-zinc-700"
									>Esta vez no ({dayName(e.day)})</button
								>
							</form>
						{/if}
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
								<input type="hidden" name="id" value={id} />
								<span class="text-sm"
									>{eventOf(id)?.repeat.every ? '¿Borrarlo, todas las veces?' : '¿Borrarlo?'}</span
								>
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
								onclick={() => (deleting = true)}>Borrar</button
							>
						{/if}
						{#if eventOf(id)?.by}
							<span class="ml-auto text-xs text-zinc-500">Lo apuntó {eventOf(id)?.by}</span>
						{/if}
					</div>
					{#if eventOf(id)?.repeat.every}
						<p class="mt-2 text-xs text-zinc-500">
							{repeatText(eventOf(id)!.repeat)}. Lo que se cambia aquí, cambia todas las veces; para
							moverlo solo una, «esta vez no» y apunta otro.
						</p>
					{/if}
				{/if}
			</div>
		</section>
	{/if}

	<nav class="mb-2 flex items-center justify-between gap-2">
		<a
			href={href(step.back)}
			class="rounded-md px-3 py-1 text-xl hover:bg-zinc-800"
			aria-label="Antes">‹</a
		>
		<h2 class="text-center font-semibold first-letter:uppercase">{title}</h2>
		<a
			href={href(step.next)}
			class="rounded-md px-3 py-1 text-xl hover:bg-zinc-800"
			aria-label="Después">›</a
		>
	</nav>
	<div class="mb-4 flex justify-center gap-2">
		<a href={href(data.day, 'semana')} class={chip(data.view === 'semana')}>Semana</a>
		<a href={href(data.day, 'mes')} class={chip(data.view === 'mes')}>Mes</a>
		{#if data.today < data.from || data.today > data.to}
			<a href={href(data.today)} class={chip(false)}>Hoy</a>
		{/if}
	</div>

	{#if data.view === 'semana'}
		<ul class="mb-10 divide-y divide-zinc-800">
			{#each week as day (day)}
				{@render dayList(day)}
			{/each}
		</ul>
	{:else}
		<div class="mb-4 grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-zinc-800 text-sm">
			{#each WEEKDAYS as w (w)}
				<span class="bg-zinc-900 py-1 text-center text-xs text-zinc-500">{w}</span>
			{/each}
			{#each days as day (day)}
				{@const list = dayEvents(data.occurrences, day)}
				<a
					href={href(day)}
					data-sveltekit-noscroll
					data-sveltekit-replacestate
					class={[
						'flex min-h-16 flex-col gap-0.5 bg-zinc-950 p-1 hover:bg-zinc-900 sm:min-h-20',
						day.slice(0, 7) !== month && 'opacity-40',
						day === data.day && 'ring-2 ring-amber-500 ring-inset'
					]}
				>
					<span
						class={['text-xs', day === data.today ? 'font-bold text-amber-400' : 'text-zinc-400']}
						>{Number(day.slice(8))}</span
					>
					{#each list.slice(0, 3) as o (`${o.eventId}-${o.day}`)}
						{@const p = person(o.people[0] ?? '')}
						<span
							class="truncate rounded px-1 text-[11px] leading-4 text-zinc-950 {p?.color ??
								'bg-zinc-300'}">{o.title}</span
						>
					{/each}
					{#if list.length > 3}
						<span class="text-[11px] text-zinc-500">+{list.length - 3}</span>
					{/if}
				</a>
			{/each}
		</div>
		<ul class="mb-10">
			{@render dayList(data.day)}
		</ul>
	{/if}

	<Alarmas alarms={data.alarms} people={data.people} readonly={data.readonly} />

	{#if data.ics}
		<section class="mb-10 rounded-lg bg-zinc-900 p-4 text-sm">
			<h2 class="mb-1 font-semibold">En el calendario del móvil</h2>
			<p class="mb-3 text-zinc-400">
				Para verla allí, solo para mirar: se añade como calendario por enlace («suscribirse» en el
				iPhone, «desde URL» en Google Calendar). Quien tenga el enlace ve la agenda entera.
			</p>
			<div class="flex flex-wrap items-center gap-2">
				<input
					readonly
					value={data.ics}
					class="{field} min-w-0 flex-1 text-xs"
					aria-label="Enlace .ics"
				/>
				<button class="{button} bg-zinc-800 hover:bg-zinc-700" onclick={() => copy(data.ics!)}
					>{copied ? 'Copiado' : 'Copiar'}</button
				>
				<a
					href={data.ics.replace(/^https?:/, 'webcal:')}
					class="{button} bg-zinc-800 hover:bg-zinc-700">Abrir en el calendario</a
				>
			</div>
			<form method="post" action="?/renewIcs" use:enhance class="mt-2">
				<button class="text-xs text-zinc-500 hover:text-zinc-300 hover:underline"
					>Cambiar el enlace (el de antes deja de funcionar)</button
				>
			</form>
		</section>
	{/if}
</div>

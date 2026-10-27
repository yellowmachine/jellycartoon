<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import {
		addDays,
		dayName,
		localDay,
		localTime,
		WEEKDAYS,
		type AgendaPerson
	} from '#lib/agenda.ts';
	import {
		daysName,
		MAX_ALARM_LABEL,
		TIMER_MINUTES,
		type Alarm,
		type AlarmInput,
		type AlarmPlace
	} from '#lib/alarms.ts';
	import { formatLeft } from '#lib/timer-names.ts';

	/**
	 * Alarms and timers (#241), in the Agenda: the house's and the user's, counting down or with
	 * their next time; set by hand, stopped, skipped once, paused or taken away. For now they sound
	 * in the whole house (Snapcast).
	 */
	let {
		alarms,
		people,
		satellites,
		readonly
	}: {
		alarms: Alarm[];
		people: AgendaPerson[];
		/** The voice satellites, where one can sound too. */
		satellites: { id: string; name: string }[];
		readonly: boolean;
	} = $props();

	const personName = (id: string) => people.find((p) => p.id === id)?.name ?? '';
	/** «Salón»: a satellite's name; one gone, said so. */
	const placeName = (place: AlarmPlace) =>
		satellites.find((s) => `satelite:${s.id}` === place)?.name ?? 'un satélite que ya no está';

	/** Ticks while a timer counts down. */
	let now = $state(Date.now());
	$effect(() => {
		if (!alarms.some((a) => a.kind === 'temporizador' && a.nextAt)) return;
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
	});

	// Live: one starts ringing, or is stopped somewhere else.
	onMount(() => {
		const events = new EventSource('/api/avisos/events');
		events.onmessage = () => void invalidateAll();
		return () => events.close();
	});

	/** «hoy a las 7:30», «mañana a las 7:30», «jueves 30 a las 7:30». */
	function when(at: number) {
		const date = new Date(at);
		const day = localDay(date);
		const today = localDay();
		const name = day === today ? 'hoy' : day === addDays(today, 1) ? 'mañana' : dayName(day);
		return `${name} a las ${localTime(date)}`;
	}

	// ——— Setting one ———

	type Every = 'una' | 'diaria' | 'laborables' | 'dias';
	const EVERY: { every: Every; label: string }[] = [
		{ every: 'una', label: 'Una vez' },
		{ every: 'diaria', label: 'Todos los días' },
		{ every: 'laborables', label: 'De lunes a viernes' },
		{ every: 'dias', label: 'Elegir días' }
	];

	interface Editing {
		kind: AlarmInput['kind'];
		label: string;
		minutes: number;
		time: string;
		day: string;
		every: Every;
		days: number[];
		people: string[];
		place: AlarmPlace;
	}

	let editing = $state<Editing | null>(null);
	let problem = $state<string | null>(null);

	function open(kind: AlarmInput['kind']) {
		problem = null;
		editing = {
			kind,
			label: '',
			minutes: 10,
			time: '07:30',
			day: localDay(),
			every: 'una',
			days: [],
			people: [],
			place: 'casa'
		};
	}

	function toggle<T>(list: T[], value: T) {
		const i = list.indexOf(value);
		if (i >= 0) list.splice(i, 1);
		else list.push(value);
	}

	/** As the server parses it (parseAlarmInput). */
	function input(e: Editing): AlarmInput {
		if (e.kind === 'temporizador')
			return { kind: e.kind, minutes: e.minutes, label: e.label, people: e.people, place: e.place };
		const days =
			e.every === 'diaria'
				? [0, 1, 2, 3, 4, 5, 6]
				: e.every === 'laborables'
					? [0, 1, 2, 3, 4]
					: e.every === 'dias'
						? e.days
						: [];
		// Once, at a time already gone today: tomorrow.
		const day =
			e.every === 'una' && e.day === localDay() && e.time <= localTime()
				? addDays(e.day, 1)
				: e.day;
		return {
			kind: e.kind,
			time: e.time,
			day,
			days,
			label: e.label,
			people: e.people,
			place: e.place
		};
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

{#snippet act(a: Alarm, what: string, label: string, style = 'bg-zinc-800 hover:bg-zinc-700')}
	<form method="post" action="?/alarm" use:enhance>
		<input type="hidden" name="id" value={a.id} />
		<button name="do" value={what} class="{button} {style}">{label}</button>
	</form>
{/snippet}

<section class="mb-10 rounded-lg bg-zinc-900 p-4" id="alarmas">
	<h2 class="mb-1 font-semibold">Alarmas y temporizadores</h2>
	<p class="mb-3 text-sm text-zinc-400">
		Los de la casa y los tuyos. Suenan en toda la casa, por los altavoces, o en un satélite de voz.
	</p>

	{#if alarms.length}
		<ul class="mb-4 divide-y divide-zinc-800">
			{#each alarms as a (a.id)}
				{@const ringing = a.ringingSince !== null}
				<li
					class={['flex flex-wrap items-center gap-x-3 gap-y-2 py-2', ringing && 'text-amber-300']}
				>
					<span class="text-lg" aria-hidden="true">{a.kind === 'alarma' ? '⏰' : '⏱️'}</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate">{a.label}</span>
						<span class="block text-xs text-zinc-400">
							{#if ringing}
								Sonando
							{:else if a.kind === 'temporizador'}
								{a.nextAt ? `Quedan ${formatLeft((a.nextAt - now) / 1000)}` : 'Ya sonó'}
							{:else if a.kind === 'preparado'}
								{formatLeft(a.seconds ?? 0)} cuando {a.trigger}
							{:else}
								{a.time}{a.days.length ? ` · ${daysName(a.days)}` : ''}
								· {a.paused ? 'pausada' : a.nextAt ? when(a.nextAt) : 'ya sonó'}
							{/if}
							{#if a.people.length}
								· {a.people.map(personName).join(', ')}
							{:else}
								· de la casa
							{/if}
							{#if a.place !== 'casa'}
								· en {placeName(a.place)}
							{/if}
						</span>
					</span>
					{#if !readonly}
						<span class="flex flex-wrap gap-2">
							{#if ringing}
								{@render act(
									a,
									'stop',
									'Parar',
									'bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400'
								)}
							{/if}
							{#if a.kind === 'alarma' && a.days.length && a.nextAt && !a.paused}
								{@render act(a, 'skip', 'Esta vez no')}
							{/if}
							{#if a.kind === 'alarma' && (a.nextAt || a.paused)}
								{@render act(a, a.paused ? 'resume' : 'pause', a.paused ? 'Activar' : 'Pausar')}
							{/if}
							{@render act(a, 'delete', 'Quitar')}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mb-4 text-sm text-zinc-500">Ninguno.</p>
	{/if}

	{#if !readonly}
		{#if editing}
			{@const e = editing}
			<form
				method="post"
				action="?/addAlarm"
				class="flex flex-col gap-4 rounded-lg border border-zinc-700 p-4"
				use:enhance={() => {
					problem = null;
					return async ({ result, update }) => {
						if (result.type === 'failure') problem = String(result.data?.message ?? 'No se pudo');
						else if (result.type === 'success') editing = null;
						await update();
					};
				}}
			>
				<input type="hidden" name="alarm" value={JSON.stringify(input(e))} />
				<h3 class="font-semibold">{e.kind === 'alarma' ? 'Nueva alarma' : 'Nuevo temporizador'}</h3>
				<div class="flex flex-wrap items-end gap-3">
					{#if e.kind === 'temporizador'}
						<label class="flex flex-col gap-1 text-xs text-zinc-400">
							Minutos
							<input
								type="number"
								bind:value={e.minutes}
								min={TIMER_MINUTES.min}
								max={TIMER_MINUTES.max}
								required
								class="{field} w-24"
							/>
						</label>
					{:else}
						<label class="flex flex-col gap-1 text-xs text-zinc-400">
							A las
							<input type="time" bind:value={e.time} required class={field} />
						</label>
						{#if e.every === 'una'}
							<label class="flex flex-col gap-1 text-xs text-zinc-400">
								Día
								<input type="date" bind:value={e.day} min={localDay()} required class={field} />
							</label>
						{/if}
					{/if}
					<label class="flex min-w-48 flex-1 flex-col gap-1 text-xs text-zinc-400">
						Nombre (si quieres)
						<input
							bind:value={e.label}
							maxlength={MAX_ALARM_LABEL}
							class={field}
							placeholder={e.kind === 'alarma' ? 'Levantarse, la pastilla…' : 'La pasta, el horno…'}
						/>
					</label>
				</div>

				{#if e.kind === 'alarma'}
					<div>
						<p class="mb-1 text-xs text-zinc-400">Se repite</p>
						<div class="flex flex-wrap gap-2">
							{#each EVERY as r (r.every)}
								<button
									type="button"
									class={chip(e.every === r.every)}
									onclick={() => (e.every = r.every)}>{r.label}</button
								>
							{/each}
						</div>
						{#if e.every === 'dias'}
							<div class="mt-2 flex flex-wrap gap-1">
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
				{/if}

				{#if satellites.length}
					<div>
						<p class="mb-1 text-xs text-zinc-400">Suena en</p>
						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								class={chip(e.place === 'casa')}
								onclick={() => (e.place = 'casa')}>Toda la casa</button
							>
							{#each satellites as s (s.id)}
								<button
									type="button"
									class={chip(e.place === `satelite:${s.id}`)}
									onclick={() => (e.place = `satelite:${s.id}`)}>{s.name}</button
								>
							{/each}
						</div>
					</div>
				{/if}

				<div>
					<p class="mb-1 text-xs text-zinc-400">Para quién (nadie: de la casa)</p>
					<div class="flex flex-wrap gap-2">
						{#each people as p (p.id)}
							<button
								type="button"
								class={chip(e.people.includes(p.id))}
								aria-pressed={e.people.includes(p.id)}
								onclick={() => toggle(e.people, p.id)}>{p.emoji ?? ''} {p.name}</button
							>
						{/each}
					</div>
				</div>

				{#if problem}<p class="text-sm text-red-400">{problem}</p>{/if}
				<div class="flex gap-2">
					<button
						class="{button} bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400"
						disabled={e.kind === 'alarma' && e.every === 'dias' && !e.days.length}>Poner</button
					>
					<button
						type="button"
						class="{button} bg-zinc-800 hover:bg-zinc-700"
						onclick={() => (editing = null)}>Cancelar</button
					>
				</div>
			</form>
		{:else}
			<div class="flex gap-2">
				<button class="{button} bg-zinc-800 hover:bg-zinc-700" onclick={() => open('alarma')}
					>⏰ Nueva alarma</button
				>
				<button class="{button} bg-zinc-800 hover:bg-zinc-700" onclick={() => open('temporizador')}
					>⏱️ Nuevo temporizador</button
				>
			</div>
		{/if}
	{/if}
</section>

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
	} from 'comun/agenda.ts';
	import AlarmIcon from '#lib/components/AlarmIcon.svelte';
	import { timeLabel } from 'comun/timer-names.ts';
	import {
		daysName,
		MAX_ALARM_LABEL,
		TIMER_MINUTES,
		type Alarm,
		type AlarmInput,
		type AlarmPlace
	} from 'comun/alarms.ts';

	/**
	 * The family's alarms (#253; jellycartoon's #241), in the Agenda: the house's and the user's,
	 * with their next time; set by hand, stopped, skipped once, paused or taken away. They sound in
	 * the house: all of it, or a voice satellite. And the timers, said to the cloud or put here, until
	 * they end: on the phone, in the house, or in a satellite's room.
	 */
	let {
		alarms,
		people,
		satellites,
		house,
		me,
		readonly
	}: {
		alarms: Alarm[];
		people: AgendaPerson[];
		/** The voice satellites, where one can sound too. */
		satellites: { id: string; name: string }[];
		/** A house is connected: a timer may sound there. */
		house: boolean;
		/** The user's person: a timer on their phones is theirs. */
		me: string | null;
		readonly: boolean;
	} = $props();

	const personName = (id: string) => people.find((p) => p.id === id)?.name ?? '';
	/** «Salón»: a satellite's name; one gone, said so. */
	const placeName = (place: AlarmPlace) =>
		place === 'movil'
			? 'el móvil'
			: (satellites.find((s) => `satelite:${s.id}` === place)?.name ??
				'un satélite que ya no está');

	// Live: one starts ringing, or is stopped somewhere else.
	onMount(() => {
		const events = new EventSource('/api/avisos/events');
		events.onmessage = () => void invalidateAll();
		return () => events.close();
	});

	// The timers' countdown, by the second.
	let now = $state(Date.now());
	onMount(() => {
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
	});

	/** «4:32», «1:05:00»: what is left. */
	function left(endsAt: number) {
		const s = Math.max(0, Math.round((endsAt - now) / 1000));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const two = (n: number) => String(n).padStart(2, '0');
		return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
	}

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
		label: string;
		time: string;
		day: string;
		every: Every;
		days: number[];
		people: string[];
		place: AlarmPlace;
	}

	let editing = $state<Editing | null>(null);
	let problem = $state<string | null>(null);

	function open() {
		problem = null;
		timing = null;
		editing = {
			label: '',
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
			kind: 'alarma',
			time: e.time,
			day,
			days,
			label: e.label,
			people: e.people,
			place: e.place
		};
	}

	// ——— Putting a timer ———

	/** The usual ones, a touch away. */
	const QUICK = [5, 10, 15, 20, 30, 45, 60];

	interface Timing {
		label: string;
		hours: number;
		minutes: number;
		place: AlarmPlace;
	}

	let timing = $state<Timing | null>(null);

	/** Where one can sound: their phones, the house, each satellite's room. */
	const timerPlaces = $derived<{ place: AlarmPlace; label: string }[]>([
		...(me ? [{ place: 'movil' as const, label: 'En el móvil' }] : []),
		...(house ? [{ place: 'casa' as const, label: 'En casa' }] : []),
		...satellites.map((s) => ({ place: `satelite:${s.id}` as const, label: s.name }))
	]);

	function openTimer() {
		problem = null;
		editing = null;
		timing = { label: '', hours: 0, minutes: 10, place: timerPlaces[0]?.place ?? 'casa' };
	}

	const timerMinutes = (t: Timing) => (Number(t.hours) || 0) * 60 + (Number(t.minutes) || 0);
	const timerOk = (t: Timing) => {
		const m = timerMinutes(t);
		return m >= TIMER_MINUTES.min && m <= TIMER_MINUTES.max;
	};

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
		Las de la casa y las tuyas. Suenan en casa: en toda, por los altavoces, o en un satélite de voz.
		Los temporizadores, por voz o aquí: en el móvil, en casa o en la habitación de un satélite.
	</p>

	{#if alarms.length}
		<ul class="mb-4 divide-y divide-zinc-800">
			{#each alarms as a (a.id)}
				{@const ringing = a.ringingSince !== null}
				{@const timer = a.kind === 'temporizador'}
				<!-- On the phone, two rows: what it is, and its buttons under the text; wider, one. -->
				<li
					class={[
						'flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:gap-3',
						ringing && 'text-amber-300'
					]}
				>
					<span class="flex min-w-0 flex-1 items-center gap-3">
						<AlarmIcon
							name={timer ? 'temporizador' : 'alarma'}
							{ringing}
							class={['h-6 w-6 shrink-0', ringing ? 'text-amber-400' : 'text-zinc-400']}
						/>
						<span class="min-w-0 flex-1">
							<span class="block truncate">{a.label}</span>
							<span class="block text-xs text-zinc-400">
								{#if ringing}
									Sonando
								{:else if timer && a.endsAt}
									<span class="font-medium text-zinc-200 tabular-nums">{left(a.endsAt)}</span>
									· acaba a las {localTime(new Date(a.endsAt))}
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
					</span>
					{#if !readonly}
						<span class="flex flex-wrap gap-2 pl-9 sm:pl-0">
							{#if ringing}
								{@render act(
									a,
									'stop',
									'Parar',
									'bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400'
								)}
							{/if}
							{#if a.days.length && a.nextAt && !a.paused}
								{@render act(a, 'skip', 'Esta vez no')}
							{/if}
							{#if !timer && (a.nextAt || a.paused)}
								{@render act(a, a.paused ? 'resume' : 'pause', a.paused ? 'Activar' : 'Pausar')}
							{/if}
							{@render act(a, 'delete', 'Quitar')}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mb-4 text-sm text-zinc-500">Ninguna.</p>
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
				<h3 class="font-semibold">Nueva alarma</h3>
				<div class="flex flex-wrap items-end gap-3">
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
					<label class="flex min-w-48 flex-1 flex-col gap-1 text-xs text-zinc-400">
						Nombre (si quieres)
						<input
							bind:value={e.label}
							maxlength={MAX_ALARM_LABEL}
							class={field}
							placeholder="Levantarse, la pastilla…"
						/>
					</label>
				</div>

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
						disabled={e.every === 'dias' && !e.days.length}>Poner</button
					>
					<button
						type="button"
						class="{button} bg-zinc-800 hover:bg-zinc-700"
						onclick={() => (editing = null)}>Cancelar</button
					>
				</div>
			</form>
		{:else if timing}
			{@const t = timing}
			<form
				method="post"
				action="?/addTimer"
				class="flex flex-col gap-4 rounded-lg border border-zinc-700 p-4"
				use:enhance={() => {
					problem = null;
					return async ({ result, update }) => {
						if (result.type === 'failure') problem = String(result.data?.message ?? 'No se pudo');
						else if (result.type === 'success') timing = null;
						await update();
					};
				}}
			>
				<input
					type="hidden"
					name="timer"
					value={JSON.stringify({
						kind: 'temporizador',
						minutes: timerMinutes(t),
						label: t.label,
						people: [],
						place: t.place
					})}
				/>
				<h3 class="font-semibold">Nuevo temporizador</h3>
				<div class="flex flex-wrap gap-2">
					{#each QUICK as m (m)}
						<button
							type="button"
							class={chip(timerMinutes(t) === m)}
							onclick={() => {
								t.hours = Math.floor(m / 60);
								t.minutes = m % 60;
							}}>{timeLabel(m * 60)}</button
						>
					{/each}
				</div>
				<div class="flex flex-wrap items-end gap-3">
					<label class="flex flex-col gap-1 text-xs text-zinc-400">
						Horas
						<input
							type="number"
							min="0"
							max="24"
							bind:value={t.hours}
							class="{field} w-20 tabular-nums"
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs text-zinc-400">
						Minutos
						<input
							type="number"
							min="0"
							max="59"
							bind:value={t.minutes}
							class="{field} w-20 tabular-nums"
						/>
					</label>
					<label class="flex min-w-48 flex-1 flex-col gap-1 text-xs text-zinc-400">
						Nombre (si quieres)
						<input
							bind:value={t.label}
							maxlength={MAX_ALARM_LABEL}
							class={field}
							placeholder="La pasta, el horno…"
						/>
					</label>
				</div>

				{#if timerPlaces.length > 1}
					<div>
						<p class="mb-1 text-xs text-zinc-400">Suena</p>
						<div class="flex flex-wrap gap-2">
							{#each timerPlaces as p (p.place)}
								<button
									type="button"
									class={chip(t.place === p.place)}
									onclick={() => (t.place = p.place)}>{p.label}</button
								>
							{/each}
						</div>
					</div>
				{/if}

				{#if problem}<p class="text-sm text-red-400">{problem}</p>{/if}
				<div class="flex gap-2">
					<button
						class="{button} bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400"
						disabled={!timerOk(t)}>Empezar</button
					>
					<button
						type="button"
						class="{button} bg-zinc-800 hover:bg-zinc-700"
						onclick={() => (timing = null)}>Cancelar</button
					>
				</div>
			</form>
		{:else}
			<div class="flex flex-wrap gap-2">
				<button
					class="{button} flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700"
					onclick={() => open()}
				>
					<AlarmIcon name="alarma" class="h-4 w-4 text-amber-400" />Nueva alarma
				</button>
				<button
					class="{button} flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700"
					onclick={() => openTimer()}
				>
					<AlarmIcon name="temporizador" class="h-4 w-4 text-amber-400" />Nuevo temporizador
				</button>
			</div>
		{/if}
	{/if}
</section>

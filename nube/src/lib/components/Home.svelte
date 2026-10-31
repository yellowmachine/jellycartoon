<script lang="ts">
	import '@fontsource/comic-neue/400.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { atHome } from '#lib/nav.ts';
	import { dayName, isOver, localDay, localTime, timeOn, type Occurrence } from 'comun/agenda.ts';
	import type { Alarm } from 'comun/alarms.ts';
	import { doseText, groupDoses, markValue, type Dose } from 'comun/medication.ts';
	import { enhance } from '$app/forms';
	import { MAX_ITEM, MAX_NOTE, PAPERS, tiltFor, type FridgeState } from 'comun/fridge.ts';
	import { thumbUrl } from 'comun/thumb.svelte.ts';
	import { distanceText } from 'comun/road.ts';
	import { skyIcon, type HourWeather, type WeatherGlance } from 'comun/weather.ts';
	import {
		arrivalOf,
		upFirst,
		warningText,
		whenText,
		type LegWeather,
		type PlannedLeg
	} from '#lib/planned-trips.ts';
	import { durationText } from '#lib/trips.ts';
	import { agoText, isMoving, walkTo, type CarView } from '#lib/cars.ts';
	import { pendingReceipt } from '#lib/pending-receipt.svelte.ts';
	import { section } from '#lib/styles.ts';
	import type { Watching } from '#lib/server/series.ts';

	/**
	 * The home page with a session (home.ts): what there is today in the family, at a glance on the
	 * phone. A new family's first steps, until done; the doses still to take (#308), theirs and their
	 * children's, to mark here; today's agenda with the alarms and timers that
	 * ring today; their «Buzón» still unread (#331); the fridge's post-its and the list, live; the
	 * shortcuts; and «Seguir viendo» with a house.
	 */
	let {
		name,
		home,
		weather,
		trip,
		car,
		watching,
		receipts
	}: {
		name: string;
		home: {
			me: string | null;
			doses: Dose[];
			fridge: FridgeState;
			tomorrow: Occurrence[];
			alarms: Alarm[];
			inbox: { count: number; latest: { id: number; title: string; body: string }[] };
			steps: { key: boolean; invited: boolean } | null;
			house: boolean;
		};
		weather: Promise<(WeatherGlance & { place: string }) | null>;
		/** Their next trip (Viajes → Próximos): its next leg, its weather, and the one after. */
		trip: Promise<{
			trip: { id: number; name: string };
			leg: PlannedLeg;
			weather: LegWeather;
			then: PlannedLeg | null;
		} | null>;
		/** Their car and where it is (#317), if they have one. */
		car: Promise<CarView | null>;
		watching: Promise<Watching[]>;
		/** A receipt's photo can be read (the family's AI). */
		receipts: boolean;
	} = $props();

	// What the others change, here at once (SSE), as in Nevera.
	let fridge = $derived<FridgeState>(home.fridge);
	$effect(() => {
		const events = new EventSource('/api/nevera/events');
		events.onmessage = (e) => (fridge = JSON.parse(e.data));
		return () => events.close();
	});

	// The clock, for the greeting, the timers and what is over.
	let now = $state(new Date());
	onMount(() => {
		const tick = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(tick);
	});

	const greeting = $derived.by(() => {
		const hour = now.getHours();
		return hour >= 6 && hour < 14
			? 'Buenos días'
			: hour >= 14 && hour < 21
				? 'Buenas tardes'
				: 'Buenas noches';
	});
	const firstName = $derived(name.trim().split(/\s+/)[0] ?? '');
	const today = $derived(localDay(now));
	const dateText = $derived(dayName(today, true));

	/** One line of «Hoy»: an event of the agenda, or an alarm or timer; by its time. */
	type Line = {
		key: string;
		at: string;
		time: string;
		title: string;
		who: string;
		over: boolean;
		ringing: boolean;
	};

	const nameOf = (id: string) => fridge.today.people.find((p) => p.id === id)?.name ?? null;
	const whoOf = (people: string[]) => people.map(nameOf).filter(Boolean).join(', ');

	function clockOf(ms: number) {
		return localTime(new Date(ms));
	}

	/** «quedan 6 min», «quedan 40 s». */
	function left(endsAt: number) {
		const s = Math.max(0, Math.round((endsAt - now.getTime()) / 1000));
		return s >= 60 ? `quedan ${Math.ceil(s / 60)} min` : `quedan ${s} s`;
	}

	const lines = $derived.by<Line[]>(() => {
		const events = fridge.today.events.map((o) => ({
			key: `e${o.eventId}-${o.day}`,
			// The whole day's, first.
			at: o.day === today && o.startTime ? o.startTime : '00:00',
			time: timeOn(o, today),
			title: o.title,
			who: whoOf(o.people),
			over: isOver(o, today, localTime(now)),
			ringing: false
		}));
		const alarms = home.alarms.map((a) => {
			const timer = a.kind === 'temporizador';
			const at = timer ? (a.endsAt ?? now.getTime()) : (a.nextAt ?? now.getTime());
			return {
				key: `a${a.id}`,
				at: clockOf(at),
				time: a.ringingSince ? 'Sonando' : timer ? `⏲️ ${left(at)}` : `⏰ ${clockOf(at)}`,
				title: a.label,
				who: whoOf(a.people),
				over: false,
				ringing: Boolean(a.ringingSince)
			};
		});
		return [...events, ...alarms].sort((a, b) => a.at.localeCompare(b.at));
	});

	const toBuy = $derived(fridge.list.items.filter((i) => !i.done).length);

	// A post-it, or something to buy, without leaving the page.
	let adding = $state<'note' | 'item' | null>(null);
	let text = $state('');
	let problem = $state<string | null>(null);
	async function add(e: SubmitEvent) {
		e.preventDefault();
		if (!text.trim() || !adding) return;
		problem = null;
		const body =
			adding === 'note' ? { action: 'note', text, until: null } : { action: 'add', text };
		const res = await fetch('/api/nevera', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}).catch(() => null);
		if (!res?.ok) return void (problem = 'No se pudo guardar. Prueba otra vez.');
		text = '';
		adding = null;
	}

	// The first steps: what the server knows, and what only this device does (installed, notices).
	const STEPS_KEY = 'seilide:primeros-pasos';
	let installed = $state(true);
	let notices = $state(true);
	let stepsClosed = $state(true);
	let installPrompt = $state<(Event & { prompt: () => Promise<void> }) | null>(null);
	onMount(() => {
		try {
			stepsClosed = localStorage.getItem(STEPS_KEY) === 'cerrado';
		} catch {
			stepsClosed = false;
		}
		installed =
			matchMedia('(display-mode: standalone)').matches ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true;
		const keep = (e: Event) => {
			e.preventDefault();
			installPrompt = e as typeof installPrompt;
		};
		addEventListener('beforeinstallprompt', keep);
		void (async () => {
			if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
			if (Notification.permission !== 'granted') return void (notices = false);
			const reg = await navigator.serviceWorker.getRegistration();
			notices = Boolean(await reg?.pushManager.getSubscription());
		})();
		return () => removeEventListener('beforeinstallprompt', keep);
	});
	function closeSteps() {
		stepsClosed = true;
		try {
			localStorage.setItem(STEPS_KEY, 'cerrado');
		} catch {
			// A private window: closed until it reloads.
		}
	}
	async function install() {
		await installPrompt?.prompt();
		installPrompt = null;
	}
	const steps = $derived([
		...(home.steps
			? [
					{
						done: home.steps.key,
						label: 'Pon la clave de IA',
						hint: 'Para la voz, los tickets y las recetas.',
						href: '/ajustes?seccion=familia#ia'
					},
					{
						done: home.steps.invited,
						label: 'Invita a tu familia',
						hint: 'Cada uno con su cuenta.',
						href: '/ajustes?seccion=familia#invitaciones'
					}
				]
			: []),
		{
			done: installed,
			label: 'Instala Seilide en el móvil',
			hint: installPrompt
				? null
				: 'En el menú del navegador, «Instalar» o «Añadir a pantalla de inicio».',
			href: null
		},
		{
			done: notices,
			label: 'Activa los avisos',
			hint: 'Para las alarmas y la agenda, con la app cerrada.',
			href: '/ajustes?seccion=aparato#avisos'
		}
	]);
	const pending = $derived(steps.some((s) => !s.done));

	const tripWeather = (w: HourWeather) =>
		`${skyIcon(w.code)} ${w.temperature} °C${w.rain >= 30 ? `, lluvia ${w.rain} %` : ''}${w.wind >= 40 ? `, viento ${w.wind} km/h` : ''}`;

	const quick =
		'flex flex-col items-center gap-1 rounded-md border border-zinc-800 p-3 text-center text-sm leading-tight hover:border-amber-500/60';
	const icon = 'h-7 w-7 text-amber-400';
</script>

<header class="mb-6">
	<h1 class="text-2xl font-bold">{greeting}{firstName ? `, ${firstName}` : ''}</h1>
	<p class="text-zinc-400">
		{upFirst(dateText)}
		{#await weather then w}
			{#if w}
				<span title={w.place}>
					· {skyIcon(w.code)}
					{w.temperature} °C
					<span class="text-sm"
						>({w.min}–{w.max} °C{w.rain >= 30 ? `, lluvia ${w.rain} %` : ''})</span
					>
				</span>
			{/if}
		{/await}
	</p>
</header>

{#if pending && !stepsClosed}
	<section class="{section} border-amber-500/40">
		<div class="mb-3 flex items-start justify-between gap-3">
			<h2 class="font-semibold">Primeros pasos</h2>
			<button onclick={closeSteps} class="text-sm text-zinc-400 hover:text-white">Ocultar</button>
		</div>
		<ul class="flex flex-col gap-2">
			{#each steps as s (s.label)}
				<li class="flex items-start gap-2">
					<span aria-hidden="true" class={s.done ? 'text-amber-400' : 'text-zinc-500'}
						>{s.done ? '✓' : '○'}</span
					>
					<div class="min-w-0 flex-1">
						{#if s.done}
							<span class="text-zinc-500 line-through">{s.label}</span>
						{:else if s.href}
							<a href={s.href} class="text-amber-400 hover:underline">{s.label}</a>
						{:else if installPrompt}
							<button onclick={install} class="text-amber-400 hover:underline">{s.label}</button>
						{:else}
							<span>{s.label}</span>
						{/if}
						{#if !s.done && s.hint}
							<p class="text-sm text-zinc-400">{s.hint}</p>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#await car then c}
	{#if c?.place}
		<section class="{section} flex items-center gap-3">
			<a href="/viajes#coches" class="min-w-0 flex-1">
				<h2 class="font-semibold">🚗 {c.name}</h2>
				<p class="text-sm text-zinc-400">
					{#if isMoving(c.place, now)}
						En marcha{c.place.by ? ` con ${c.place.by}` : ''}
					{:else}
						Aparcado {agoText(new Date(c.place.when), now)}{c.place.by ? ` · ${c.place.by}` : ''}
					{/if}
				</p>
				{#if c.place.note}
					<p class="truncate text-sm text-amber-300">{c.place.note}</p>
				{/if}
			</a>
			<a
				href={walkTo(c.place.at)}
				target="_blank"
				rel="noreferrer"
				class="shrink-0 rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900"
				>Llévame</a
			>
		</section>
	{/if}
{/await}

{#await trip then next}
	{#if next}
		{@const arrival = arrivalOf(next.leg)}
		<a href="/viajes" class="{section} block border-amber-500/40 hover:border-amber-500/70">
			<h2 class="font-semibold">
				🚗 {next.trip.name}
				<span class="font-normal text-zinc-400">· {whenText(next.leg.day, today)}</span>
			</h2>
			<p class="text-sm">
				{upFirst(dayName(next.leg.day))}, {next.leg.time} ·
				{next.leg.from} → {next.leg.to}
			</p>
			<p class="mb-2 text-sm text-zinc-400">
				{durationText(next.leg.duration)} · {distanceText(next.leg.distance)} · llega a las {arrival.time}
			</p>
			{#if next.weather.depart || next.weather.arrive}
				<dl class="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
					{#if next.weather.depart}
						<dt class="text-zinc-400">Salida</dt>
						<dd>{tripWeather(next.weather.depart)}</dd>
					{/if}
					{#if next.weather.arrive}
						<dt class="text-zinc-400">Llegada</dt>
						<dd>{tripWeather(next.weather.arrive)}</dd>
					{/if}
				</dl>
			{:else}
				<p class="text-sm text-zinc-500">El tiempo, cuando quede menos para salir.</p>
			{/if}
			{#if next.weather.way?.length}
				<ul class="mt-2 flex flex-col gap-0.5 text-sm text-amber-300">
					{#each next.weather.way as w (`${w.hazard}${w.from}`)}<li>⚠ {warningText(w)}</li>{/each}
				</ul>
			{:else if next.weather.way}
				<p class="mt-1 text-sm text-zinc-400">Camino sin avisos de tiempo.</p>
			{/if}
			{#if next.then}
				<p class="mt-2 border-t border-zinc-800 pt-2 text-sm text-zinc-400">
					Después: {dayName(next.then.day)}, {next.then.time} · {next.then.from} → {next.then.to}
				</p>
			{/if}
		</a>
	{/if}
{/await}

{#if home.inbox.count}
	<section class="{section} border-amber-500/40">
		<div class="mb-3 flex items-baseline justify-between">
			<h2 class="font-semibold">
				📬 Buzón <span class="text-sm font-normal text-zinc-400">· {home.inbox.count} sin leer</span
				>
			</h2>
			<a href="/buzon" class="text-sm text-amber-400 hover:underline">Ver todo</a>
		</div>
		<ul class="flex flex-col gap-1 text-sm">
			{#each home.inbox.latest as n (n.id)}
				<li class="truncate">
					<a href="/buzon" class="hover:underline"
						><span class="font-medium">{n.title}</span>
						<span class="text-zinc-400">· {n.body}</span></a
					>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if home.doses.length}
	<section class={section}>
		<div class="mb-3 flex items-baseline justify-between">
			<h2 class="font-semibold">Tomas de hoy</h2>
			<a href="/agenda/medicacion" class="text-sm text-amber-400 hover:underline">Medicación</a>
		</div>
		<ul class="flex flex-col gap-2">
			{#each groupDoses(home.doses) as g (`${g.time}-${g.personId}`)}
				{@const late = g.time <= localTime(now)}
				<li>
					<form
						method="post"
						action="/agenda/medicacion?/mark"
						use:enhance
						class="flex items-center gap-3"
					>
						<input type="hidden" name="day" value={g.day} />
						<input type="hidden" name="time" value={g.time} />
						<span
							class={[
								'w-12 shrink-0 text-sm tabular-nums',
								late ? 'font-semibold text-amber-400' : 'text-zinc-400'
							]}>{g.time}</span
						>
						<span class="min-w-0 flex-1"
							>{g.doses
								.map(doseText)
								.join(' · ')}{#if g.personId !== home.me && nameOf(g.personId)}<span
									class="text-sm text-zinc-500"
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
							class="shrink-0 rounded-md bg-amber-500 px-3 py-1 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
							>{g.doses.length > 1 ? 'Tomadas' : 'Tomada'}</button
						>
					</form>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class={section}>
	<div class="mb-3 flex items-baseline justify-between">
		<h2 class="font-semibold">Hoy</h2>
		<a href="/agenda" class="text-sm text-amber-400 hover:underline">Agenda</a>
	</div>
	{#if lines.length}
		<ul class="flex flex-col gap-2">
			{#each lines as l (l.key)}
				<li class={['flex gap-3', l.over && 'text-zinc-500']}>
					<span
						class={[
							'w-28 shrink-0 text-sm tabular-nums',
							l.ringing ? 'font-semibold text-amber-400' : 'text-zinc-400'
						]}>{l.time}</span
					>
					<span class="min-w-0 flex-1"
						>{l.title}{#if l.who}<span class="text-sm text-zinc-500"> · {l.who}</span>{/if}</span
					>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-zinc-400">Nada para hoy.</p>
	{/if}
	{#if home.tomorrow.length}
		<p class="mt-3 border-t border-zinc-800 pt-3 text-sm text-zinc-400">
			Mañana: {home.tomorrow
				.map((o) => (o.startTime ? `${o.startTime} ${o.title}` : o.title))
				.join(' · ')}
		</p>
	{/if}
</section>

<section class={section}>
	<div class="mb-3 flex items-baseline justify-between">
		<h2 class="font-semibold">En la nevera</h2>
		<a href="/nevera" class="text-sm text-amber-400 hover:underline">Nevera</a>
	</div>
	{#if fridge.notes.length}
		<ul class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
			{#each fridge.notes as note (note.id)}
				{@const paper = PAPERS[note.author?.paper ?? 0]}
				<li
					class="paper hand line-clamp-5 text-lg leading-snug break-words"
					style="--bg: {paper.bg}; --ink: {paper.ink}; transform: rotate({tiltFor(note.id)}deg)"
				>
					{note.text}
				</li>
			{/each}
		</ul>
	{/if}
	<a href="/nevera" class="text-sm hover:underline"
		>🛒 {toBuy ? `Compra: ${toBuy} ${toBuy === 1 ? 'cosa' : 'cosas'}` : 'La compra está vacía'} →</a
	>
	{#if adding}
		<form onsubmit={add} class="mt-3 flex gap-2">
			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:value={text}
				autofocus
				maxlength={adding === 'note' ? MAX_NOTE : MAX_ITEM}
				placeholder={adding === 'note' ? 'Recoger el paquete…' : 'Leche…'}
				aria-label={adding === 'note' ? 'Texto del post-it' : 'Qué comprar'}
				class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
			/>
			<button class="rounded-md bg-amber-500 px-3 py-1 text-sm font-semibold text-zinc-950"
				>{adding === 'note' ? 'Pegar' : 'Añadir'}</button
			>
			<button
				type="button"
				onclick={() => ((adding = null), (text = ''))}
				class="text-sm text-zinc-400 hover:text-white">Cancelar</button
			>
		</form>
	{:else}
		<div class="mt-3 flex gap-4 text-sm">
			<button onclick={() => (adding = 'note')} class="text-amber-400 hover:underline"
				>+ Post-it</button
			>
			<button onclick={() => (adding = 'item')} class="text-amber-400 hover:underline"
				>+ A la compra</button
			>
		</div>
	{/if}
	{#if problem}
		<p class="mt-2 text-sm text-red-400">{problem}</p>
	{/if}
</section>

<!-- Drawn as the bar's sections, not emoji. The kitchen mode is the house's (its timers, its
     recipes step by step): there, turned on by the link. -->
<div class={['mb-8 grid gap-3', home.house ? 'grid-cols-4' : 'grid-cols-3']}>
	<a href="/voz" class={quick}><SectionIcon name="podcasts" class={icon} />Hablar</a>
	{#if receipts}
		<label class="{quick} cursor-pointer">
			<SectionIcon name="gastos" class={icon} />Ticket
			<input
				type="file"
				accept="image/*"
				capture="environment"
				class="hidden"
				onchange={(e) => {
					const photo = e.currentTarget.files?.[0];
					e.currentTarget.value = '';
					if (!photo) return;
					pendingReceipt.photo = photo;
					void goto('/gastos');
				}}
			/>
		</label>
	{:else}
		<a href="/gastos" class={quick}><SectionIcon name="gastos" class={icon} />Gastos</a>
	{/if}
	<a href="/carretera" class={quick}><SectionIcon name="viajes" class={icon} />Carretera</a>
	{#if home.house}
		<a href={atHome(page.data.webUrl ?? null, '/voz?cocina')} class={quick}
			><SectionIcon name="recetas" class={icon} />Modo cocina</a
		>
	{/if}
</div>

{#if home.house}
	{#await watching then episodes}
		{#if episodes.length}
			<section class="mb-8">
				<div class="mb-3 flex items-baseline justify-between">
					<h2 class="font-semibold">Seguir viendo</h2>
					<a href="/series" class="text-sm text-amber-400 hover:underline">Series</a>
				</div>
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
					{#each episodes.slice(0, 3) as ep (ep.id)}
						<a href="/watch/{ep.id}" class="group">
							<div class="relative aspect-video overflow-hidden rounded-md bg-zinc-800">
								<img
									src={thumbUrl(ep.id)}
									alt=""
									class="h-full w-full object-cover group-hover:opacity-80"
								/>
								<div class="absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
									<div
										class="h-full bg-amber-400"
										style:width="{(ep.positionSec / (ep.durationSec || 1)) * 100}%"
									></div>
								</div>
							</div>
							<p class="mt-1 truncate text-sm">{ep.seriesTitle}</p>
							<p class="truncate text-xs text-zinc-400">T{ep.season} E{ep.number} · {ep.title}</p>
						</a>
					{/each}
				</div>
			</section>
		{/if}
	{/await}
{/if}

<style>
	.paper {
		background: var(--bg);
		color: var(--ink);
		padding: 0.75rem;
		min-height: 5.5rem;
		box-shadow:
			0 10px 16px -8px #0009,
			0 2px 3px #0004;
		border-radius: 2px;
	}
	.hand {
		font-family: 'Comic Neue', cursive;
	}
</style>

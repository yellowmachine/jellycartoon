<script lang="ts">
	import Columns from './Columns.svelte';
	import { timeWatched } from './time-watched.ts';
	import type { PageProps } from './$types';

	/**
	 * Estadísticas (#421): what is watched, listened to and played, one's own and the children's, in
	 * three tabs that are not added up together.
	 */
	let { data }: PageProps = $props();

	const stats = $derived(data.stats);
	const total = $derived(stats.people.reduce((sum, p) => sum + p.seconds, 0));
	const topPerson = $derived(Math.max(...stats.people.map((p) => p.seconds), 1));
	const topTitle = $derived(Math.max(...stats.titles.map((t) => t.seconds), 1));
	const nameOf = (p: { name: string; me: boolean }) => (p.me ? 'Tú' : p.name);

	const dayMonth = new Intl.DateTimeFormat('es', {
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	});
	const weekLabel = (monday: string) => dayMonth.format(new Date(`${monday}T00:00:00Z`));

	const KIND = {
		serie: 'Serie',
		pelicula: 'Película',
		canal: 'Canal',
		web: 'Web',
		juego: 'Juego',
		podcast: 'Podcast',
		cancion: 'Canción',
		radio: 'Radio'
	};
	const KINDS = {
		serie: 'Series',
		pelicula: 'Películas',
		canal: 'Canales',
		web: 'Webs',
		juego: 'Juegos',
		podcast: 'Podcasts',
		cancion: 'Música',
		radio: 'Radio'
	};

	const AREA = { ver: 'Ver', escuchar: 'Escuchar', jugar: 'Jugar' };

	/** This page with what is chosen now, but for what changes. */
	const link = (change: {
		persona?: string | null;
		semanas?: number;
		tipo?: string | null;
		que?: string;
	}) => {
		const chosen = {
			semanas: data.period,
			persona: stats.person,
			tipo: stats.kind as string | null,
			que: stats.area as string,
			...change
		};
		const params = new URLSearchParams({ semanas: String(chosen.semanas) });
		if (chosen.que !== 'ver') params.set('que', chosen.que);
		if (chosen.persona) params.set('persona', chosen.persona);
		if (chosen.tipo) params.set('tipo', chosen.tipo);
		return `?${params}`;
	};
	const kindChips = $derived(
		stats.kind && !stats.kinds.includes(stats.kind) ? [...stats.kinds, stats.kind] : stats.kinds
	);

	const weekdayDay = new Intl.DateTimeFormat('es', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	});
	const dayOf = (day: string) => new Date(`${day}T00:00:00Z`);
	/** «Hoy», «Ayer», «lun, 3 nov». */
	const dayLabel = (day: string) => {
		if (day === data.today) return 'Hoy';
		if (day === stats.days.at(-2)?.day) return 'Ayer';
		return weekdayDay.format(dayOf(day));
	};
	const dayColumns = $derived(
		stats.days.map((d) => ({ key: d.day, label: dayLabel(d.day), seconds: d.seconds }))
	);
	// Every four days, the last of them near today, as many as fit on a phone.
	const dayTicks = $derived(
		stats.days
			.filter((_, i) => (stats.days.length - 2 - i) % 4 === 0)
			.map((d) => ({ key: d.day, label: dayMonth.format(dayOf(d.day)) }))
	);
	const nameOfId = $derived(new Map(stats.people.map((p) => [p.id, nameOf(p)])));
	/** Whose each one is, when it may be someone else's. */
	const showWhose = $derived(!stats.person && stats.people.length > 1);
	const detailOf = (w: (typeof stats.latest)[number]) =>
		w.kind === 'serie'
			? [w.season != null && w.number != null ? `T${w.season} E${w.number}` : null, w.title]
					.filter(Boolean)
					.join(' · ')
			: w.kind === 'podcast' || (w.kind === 'cancion' && w.seriesTitle)
				? `${KIND[w.kind]} · ${w.title}`
				: KIND[w.kind];
	const chip = (on: boolean) =>
		`rounded-full px-3 py-1 text-sm ${on ? 'bg-amber-500 font-medium text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700'}`;

	const weekColumns = $derived(
		stats.weeks.map((w) => ({
			key: w.monday,
			label: `Semana del ${weekLabel(w.monday)}`,
			seconds: w.seconds
		}))
	);
	// The first and every so many, as many as fit on a phone.
	const weekTicks = $derived.by(() => {
		const every = Math.max(1, Math.ceil(stats.weeks.length / 4));
		return stats.weeks
			.filter((_, i) => i % every === 0)
			.map((w) => ({ key: w.monday, label: weekLabel(w.monday) }));
	});
	const hourColumns = $derived(
		stats.hours.map((h) => ({
			key: String(h.hour),
			label: `De ${h.hour} a ${h.hour + 1}`,
			seconds: h.seconds
		}))
	);
	const hourTicks = [0, 6, 12, 18].map((h) => ({ key: String(h), label: `${h}:00` }));
</script>

<svelte:head><title>Estadísticas</title></svelte:head>

<h1 class="mb-1 text-2xl font-bold">Estadísticas</h1>
<p class="mb-6 text-sm text-zinc-400">
	Lo que se ve, se juega y se escucha, tuyo y de los peques. Lo de otros adultos no sale aquí.
</p>

<nav class="mb-4 flex gap-1 border-b border-zinc-800" aria-label="Qué">
	{#each stats.areas as a (a.area)}
		<a
			href={link({ que: a.area, tipo: null })}
			class={[
				'-mb-px border-b-2 px-3 py-2 text-sm',
				a.area === stats.area
					? 'border-amber-500 font-medium text-zinc-100'
					: 'border-transparent text-zinc-400 hover:text-zinc-200'
			]}
			aria-current={a.area === stats.area ? 'page' : undefined}
		>
			{AREA[a.area]}
			<span class="block text-xs text-zinc-500">{timeWatched(a.seconds)}</span>
		</a>
	{/each}
</nav>

<nav class="mb-3 flex flex-wrap gap-2" aria-label="Periodo">
	{#each data.periods as weeks (weeks)}
		<a
			href={link({ semanas: weeks })}
			class={chip(weeks === data.period)}
			aria-current={weeks === data.period ? 'true' : undefined}>{weeks} semanas</a
		>
	{/each}
</nav>

{#if kindChips.length > 1 || (stats.kind && kindChips.length)}
	<nav class="mb-3 flex flex-wrap gap-2" aria-label="Tipo">
		<a href={link({ tipo: null })} class={chip(!stats.kind)}>Todo</a>
		{#each kindChips as kind (kind)}
			<a
				href={link({ tipo: kind })}
				class={chip(stats.kind === kind)}
				aria-current={stats.kind === kind ? 'true' : undefined}>{KINDS[kind]}</a
			>
		{/each}
	</nav>
{/if}

{#if !total}
	<p class="mt-6 text-zinc-400">
		{#if stats.kind}
			Nada de {KINDS[stats.kind].toLowerCase()} en este periodo.
		{:else if stats.areas.some((a) => a.seconds)}
			Nada que {stats.area} en este periodo.
		{:else}
			Todavía no hay nada en este periodo. Lo visto, jugado y escuchado en casa llega aquí cada 10
			minutos, desde que la casa tiene esta versión y con Seilide conectada.
		{/if}
	</p>
{:else}
	<nav class="mb-6 flex flex-wrap gap-2" aria-label="Persona">
		<a href={link({ persona: null })} class={chip(!stats.person)}>Todos</a>
		{#each stats.people as person (person.id)}
			<a href={link({ persona: person.id })} class={chip(stats.person === person.id)}
				>{nameOf(person)}</a
			>
		{/each}
	</nav>

	<section class="mb-8">
		<h2 class="mb-2 font-semibold">Por persona</h2>
		<ul class="space-y-2">
			{#each stats.people as person (person.id)}
				<li>
					<div class="flex justify-between gap-3 text-sm">
						<span class="truncate">{nameOf(person)}</span>
						<span class="shrink-0 text-zinc-300">{timeWatched(person.seconds)}</span>
					</div>
					<div class="h-2">
						<div
							class="h-full rounded-r bg-amber-600"
							style:width="{(person.seconds / topPerson) * 100}%"
						></div>
					</div>
				</li>
			{/each}
		</ul>
	</section>

	<Columns title="Últimos {stats.days.length} días" columns={dayColumns} ticks={dayTicks} />

	<section class="mb-8">
		<h2 class="mb-2 font-semibold">Lo último</h2>
		{#if stats.latest.length}
			<ul class="space-y-2 text-sm">
				{#each stats.latest as w (`${w.userId} ${w.item}`)}
					<li>
						<span class="block truncate">{w.seriesTitle ?? w.title}</span>
						<span class="block truncate text-xs text-zinc-400">
							{#if showWhose}{nameOfId.get(w.userId)} ·
							{/if}{detailOf(w)} · {timeWatched(w.seconds)} · {dayLabel(w.lastDay)}
						</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-zinc-400">Nada en estos {stats.days.length} días.</p>
		{/if}
	</section>

	<Columns title="Por semana" columns={weekColumns} ticks={weekTicks} />
	<Columns title="A qué horas" columns={hourColumns} ticks={hourTicks} />

	<section class="mb-8">
		<h2 class="mb-2 font-semibold">Por título</h2>
		{#if stats.titles.length}
			<ul class="space-y-2">
				{#each stats.titles as title (`${title.kind} ${title.label}`)}
					<li>
						<div class="flex justify-between gap-3 text-sm">
							<span class="min-w-0 truncate"
								>{title.label}
								<span class="text-xs text-zinc-500">{KIND[title.kind]}</span></span
							>
							<span class="shrink-0 text-zinc-300">{timeWatched(title.seconds)}</span>
						</div>
						<div class="h-2">
							<div
								class="h-full rounded-r bg-amber-600"
								style:width="{(title.seconds / topTitle) * 100}%"
							></div>
						</div>
					</li>
				{/each}
			</ul>
			{#if stats.moreTitles}
				<p class="mt-2 text-xs text-zinc-500">Y {stats.moreTitles} más, con menos tiempo.</p>
			{/if}
		{:else}
			<p class="text-sm text-zinc-400">Nada de esta persona en este periodo.</p>
		{/if}
	</section>
{/if}

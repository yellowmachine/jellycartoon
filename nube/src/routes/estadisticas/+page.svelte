<script lang="ts">
	import Columns from './Columns.svelte';
	import { timeWatched } from './time-watched.ts';
	import type { PageProps } from './$types';

	/** Estadísticas (#421): what is watched at home, one's own and the children's. */
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

	const KIND = { serie: 'Serie', pelicula: 'Película', canal: 'Canal', web: 'Web' };

	const link = (persona: string | null, semanas: number) => {
		const params = new URLSearchParams({ semanas: String(semanas) });
		if (persona) params.set('persona', persona);
		return `?${params}`;
	};
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
	Lo que se ve en casa, tuyo y de los peques. Lo de otros adultos no sale aquí.
</p>

<nav class="mb-3 flex flex-wrap gap-2" aria-label="Periodo">
	{#each data.periods as weeks (weeks)}
		<a
			href={link(stats.person, weeks)}
			class={chip(weeks === data.period)}
			aria-current={weeks === data.period ? 'true' : undefined}>{weeks} semanas</a
		>
	{/each}
</nav>

{#if !total}
	<p class="mt-6 text-zinc-400">
		Todavía no hay nada en este periodo. Lo visto en casa llega aquí cada 10 minutos, desde que la
		casa tiene esta versión y con Seilide conectada.
	</p>
{:else}
	<nav class="mb-6 flex flex-wrap gap-2" aria-label="Persona">
		<a href={link(null, data.period)} class={chip(!stats.person)}>Todos</a>
		{#each stats.people as person (person.id)}
			<a href={link(person.id, data.period)} class={chip(stats.person === person.id)}
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

	<Columns title="Por semana" columns={weekColumns} ticks={weekTicks} />
	<Columns title="A qué horas" columns={hourColumns} ticks={hourTicks} />

	<section class="mb-8">
		<h2 class="mb-2 font-semibold">Por serie</h2>
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

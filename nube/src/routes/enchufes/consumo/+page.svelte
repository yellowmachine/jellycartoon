<script lang="ts">
	import { energyText, euroText } from '#lib/plugs.ts';
	import { kwhPriceText } from '#lib/kwh-price.ts';
	import { STATS_VIEWS, VIEW_LABELS, type StatsView } from '#lib/plug-stats.ts';
	import type { PageProps } from './$types';

	/**
	 * Enchufes → Consumo (#396): what the plugs used by day, week, month and year, in columns; the
	 * period before to compare; each plug's part (with all of them, in each column too), and punta,
	 * llano and valle with such a tariff.
	 */
	let { data }: PageProps = $props();
	const s = $derived(data.stats);

	let picked = $state<string | null>(null);
	const top = $derived(Math.max(...s.buckets.map((b) => b.wh), 1));
	const shown = $derived(s.buckets.find((b) => b.key === picked));
	const plugTop = $derived(Math.max(...s.byPlug.map((p) => p.wh), 1));

	const PERIOD_NAMES = { P1: 'Punta', P2: 'Llano', P3: 'Valle' } as const;

	/**
	 * With all of them, each column in coloured parts, one per plug. A plug keeps its colour (by
	 * when it was added, not by how much it uses); past the eighth, «Otros» in grey. The palette is
	 * the dataviz skill's categorical one stepped for a dark background, checked on zinc-950.
	 */
	const COLORS = [
		'#3987e5',
		'#d95926',
		'#199e70',
		'#c98500',
		'#d55181',
		'#008300',
		'#9085e9',
		'#e66767'
	];
	const OTHERS = { id: 'otros', name: 'Otros', color: '#71717a' };
	/** The series, most used in the period first (at the bottom of each column). */
	const series = $derived.by(() => {
		if (s.plugId || s.byPlug.length < 2) return [];
		const list: { id: string; name: string; color: string; ids: string[]; wh: number }[] = [];
		let others: (typeof list)[number] | null = null;
		for (const p of s.byPlug) {
			const slot = s.plugs.findIndex((x) => x.id === p.id);
			if (slot >= 0 && slot < COLORS.length) {
				list.push({ id: p.id, name: p.name, color: COLORS[slot]!, ids: [p.id], wh: p.wh });
			} else {
				others ??= { ...OTHERS, ids: [], wh: 0 };
				others.ids.push(p.id);
				others.wh += p.wh;
			}
		}
		if (others) list.push(others);
		return list;
	});
	const whOf = (b: (typeof s.buckets)[number], ids: string[]) =>
		ids.reduce((sum, id) => sum + (b.parts[id] ?? 0), 0);
	const colorOf = (id: string) => series.find((x) => x.ids.includes(id))?.color;
	/** The column's parts, bottom up, only those with something. */
	const partsOf = (b: (typeof s.buckets)[number]) =>
		series.map((x) => ({ ...x, wh: whOf(b, x.ids) })).filter((x) => x.wh > 0);
	/** «Termo 1,9 kWh · Nevera 400 Wh», most first. */
	const breakdown = (b: (typeof s.buckets)[number]) =>
		partsOf(b)
			.sort((x, y) => y.wh - x.wh)
			.map((x) => `${x.name} ${energyText(x.wh)}`)
			.join(' · ');

	/** The address of this page with something changed. */
	function link(change: { ver?: StatsView; dia?: string | null; enchufe?: string | null }) {
		const q = new URLSearchParams();
		const ver = change.ver ?? s.view;
		const dia = change.dia === undefined ? s.day : change.dia;
		const enchufe = change.enchufe === undefined ? s.plugId : change.enchufe;
		if (ver !== 'semana') q.set('ver', ver);
		if (dia && dia !== s.today) q.set('dia', dia);
		if (enchufe) q.set('enchufe', enchufe);
		const query = q.toString();
		return `/enchufes/consumo${query ? `?${query}` : ''}`;
	}

	const both = (wh: number, euros: number | null) =>
		`${energyText(wh)}${euros === null ? '' : ` · ${euroText(euros)}`}`;

	/** «12 % más», «30 % menos», «igual»; null with nothing before. */
	const change = $derived.by(() => {
		if (!s.before.wh) return null;
		const pct = Math.round(((s.total.wh - s.before.wh) / s.before.wh) * 100);
		if (Math.abs(pct) < 3) return 'casi igual que';
		return pct > 0 ? `un ${pct} % más que` : `un ${-pct} % menos que`;
	});
	const beforeName = $derived(
		{
			dia: 'el día anterior',
			semana: 'la semana anterior',
			mes: 'el mes anterior',
			año: 'el año anterior'
		}[s.view]
	);

	const tab = 'rounded-md px-3 py-1.5 text-sm';
</script>

<svelte:head>
	<title>Consumo · Enchufes · Seilide</title>
</svelte:head>

<p class="mb-2 text-sm">
	<a href="/enchufes" class="text-zinc-400 hover:text-white">← Enchufes</a>
</p>
<h1 class="mb-4 text-2xl font-bold">Consumo</h1>

{#if !s.plugs.length}
	<p class="text-zinc-400">Todavía no hay enchufes: añade uno en Enchufes.</p>
{:else}
	<nav class="mb-3 flex flex-wrap gap-1" aria-label="Qué enchufe">
		<a
			href={link({ enchufe: null })}
			class="{tab} {s.plugId ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-amber-600 text-white'}"
			aria-current={s.plugId ? undefined : 'page'}>Todos</a
		>
		{#each s.plugs as p (p.id)}
			<a
				href={link({ enchufe: p.id })}
				class="{tab} {s.plugId === p.id
					? 'bg-amber-600 text-white'
					: 'bg-zinc-800 hover:bg-zinc-700'}"
				aria-current={s.plugId === p.id ? 'page' : undefined}>{p.icon} {p.name}</a
			>
		{/each}
	</nav>

	<nav class="mb-4 flex flex-wrap gap-1" aria-label="Por">
		{#each STATS_VIEWS as v (v)}
			<a
				href={link({ ver: v })}
				class="{tab} {s.view === v ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800 hover:bg-zinc-700'}"
				aria-current={s.view === v ? 'page' : undefined}>{VIEW_LABELS[v]}</a
			>
		{/each}
	</nav>

	<div class="mb-2 flex items-center justify-between gap-2">
		<a
			href={link({ dia: s.prevDay })}
			class="rounded-md px-3 py-1 hover:bg-zinc-800"
			aria-label="Anterior">‹</a
		>
		<h2 class="text-center font-semibold">{s.title}</h2>
		{#if s.nextDay}
			<a
				href={link({ dia: s.nextDay })}
				class="rounded-md px-3 py-1 hover:bg-zinc-800"
				aria-label="Siguiente">›</a
			>
		{:else}
			<span class="px-3 py-1 text-zinc-700" aria-hidden="true">›</span>
		{/if}
	</div>

	<p class="mb-4 text-center text-sm text-zinc-400">
		<span class="text-lg font-semibold text-white tabular-nums"
			>{both(s.total.wh, s.total.euros)}</span
		>
		{#if change}
			<br />{change}
			{beforeName}{s.goingOn ? ' hasta este punto' : ''} ({both(s.before.wh, s.before.euros)})
		{/if}
	</p>

	<section class="mb-8">
		<p
			class="mb-1 {series.length ? 'min-h-10' : 'min-h-5'} text-sm text-zinc-400"
			aria-live="polite"
		>
			{#if shown}{shown.label}: {both(shown.wh, shown.euros)}{#if series.length && shown.wh}<br
					/><span class="text-zinc-500">{breakdown(shown)}</span>{/if}{/if}
		</p>
		<div class="flex h-40 items-end gap-0.5 border-b border-zinc-700">
			{#each s.buckets as b (b.key)}
				<button
					type="button"
					class="group flex h-full min-w-0 flex-1 items-end"
					aria-label="{b.label}: {both(b.wh, b.euros)}{series.length && b.wh
						? `. ${breakdown(b)}`
						: ''}"
					onmouseenter={() => (picked = b.key)}
					onmouseleave={() => (picked = null)}
					onfocus={() => (picked = b.key)}
					onblur={() => (picked = null)}
					onclick={() => (picked = b.key)}
				>
					{#if series.length}
						<span
							class="flex w-full flex-col-reverse overflow-hidden rounded-t group-hover:brightness-125 group-focus:brightness-125"
							style:height="{(b.wh / top) * 100}%"
						>
							{#each partsOf(b) as x, i (x.id)}
								<span
									class="block w-full shrink-0 {i ? 'border-b-2 border-zinc-950' : ''}"
									style:height="{(x.wh / b.wh) * 100}%"
									style:background-color={x.color}
								></span>
							{/each}
						</span>
					{:else}
						<span
							class="block w-full rounded-t bg-amber-600 group-hover:bg-amber-500 group-focus:bg-amber-500"
							style:height="{(b.wh / top) * 100}%"
						></span>
					{/if}
				</button>
			{/each}
		</div>
		<div class="mt-1 flex gap-0.5 text-xs text-zinc-500" aria-hidden="true">
			{#each s.buckets as b (b.key)}
				<span class="relative h-4 min-w-0 flex-1">
					{#if b.tick}<span class="absolute left-0 whitespace-nowrap">{b.tick}</span>{/if}
				</span>
			{/each}
		</div>
		{#if series.length}
			<ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
				{#each series as x (x.id)}
					<li class="flex items-center gap-1.5">
						<span class="size-2.5 rounded-sm" style:background-color={x.color}></span>{x.name}
					</li>
				{/each}
			</ul>
		{/if}
		<details class="mt-2 text-sm text-zinc-400">
			<summary class="cursor-pointer">Ver como tabla</summary>
			<div class="overflow-x-auto">
				<table class="mt-2 w-full {series.length ? '' : 'max-w-sm'}">
					{#if series.length}
						<thead>
							<tr class="border-b border-zinc-700 text-xs">
								<td></td>
								{#each series as x (x.id)}
									<th scope="col" class="px-2 py-1 text-right font-normal whitespace-nowrap"
										>{x.name}</th
									>
								{/each}
								<th scope="col" class="py-1 pl-2 text-right font-normal">Total</th>
							</tr>
						</thead>
					{/if}
					<tbody>
						{#each s.buckets as b (b.key)}
							<tr class="border-b border-zinc-800">
								<th scope="row" class="py-1 pr-3 text-left font-normal whitespace-nowrap"
									>{b.label}</th
								>
								{#each series as x (x.id)}
									<td class="px-2 py-1 text-right whitespace-nowrap tabular-nums"
										>{energyText(whOf(b, x.ids))}</td
									>
								{/each}
								<td class="py-1 pl-2 text-right whitespace-nowrap text-zinc-200 tabular-nums"
									>{both(b.wh, b.euros)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	</section>

	{#if s.byPlug.length > 1}
		<section class="mb-8">
			<h2 class="mb-2 font-semibold">Por enchufe</h2>
			<ul class="space-y-2 text-sm">
				{#each s.byPlug as p (p.id)}
					<li>
						<div class="flex justify-between gap-2">
							<a href={link({ enchufe: p.id })} class="hover:underline">{p.name}</a>
							<span class="text-zinc-400 tabular-nums"
								>{both(p.wh, p.euros)} · {Math.round((p.wh / s.total.wh) * 100)} %</span
							>
						</div>
						<div class="mt-1 h-2 rounded bg-zinc-800">
							<div
								class="h-2 rounded bg-amber-600"
								style:width="{(p.wh / plugTop) * 100}%"
								style:background-color={colorOf(p.id)}
							></div>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if s.byPeriod && s.total.wh}
		<section class="mb-8">
			<h2 class="mb-2 font-semibold">Punta, llano y valle</h2>
			<ul class="space-y-1 text-sm">
				{#each s.byPeriod as p (p.name)}
					<li class="flex justify-between gap-2">
						<span>{PERIOD_NAMES[p.name]}</span>
						<span class="text-zinc-400 tabular-nums"
							>{both(p.wh, p.euros)} · {Math.round((p.wh / s.total.wh) * 100)} %</span
						>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<p class="text-xs text-zinc-500">
		{#if s.price}
			En euros, al precio de ahora: {kwhPriceText(s.price)}. Solo lo que pasa por los enchufes, no
			toda la casa.
		{:else}
			Sin precio del kWh, en euros no se sabe: sube la factura de la luz a Gastos o ponlo en
			Enchufes.
		{/if}
	</p>
{/if}

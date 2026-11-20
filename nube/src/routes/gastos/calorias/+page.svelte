<script lang="ts">
	import { onDestroy } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import ExpenseTabs from '#lib/components/ExpenseTabs.svelte';
	import GuideLink from '#lib/components/GuideLink.svelte';
	import { ADULT_KCAL, CHILD_SHARE, kcal, peopleText } from '#lib/calories.ts';
	import type { PageProps } from './$types';

	/**
	 * Dinero → Calorías (#562): the kcal bought a day per person, week by week, with one's own walks
	 * under them; by tag; and the products, each estimated by the AI, to correct by hand.
	 */
	let { data }: PageProps = $props();

	/** At most, the products listed at first. */
	const SHOWN = 30;

	let picked = $state<string | null>(null);
	const shown = $derived(
		data.weeks.find((w) => w.week === picked) ?? data.weeks[data.weeks.length - 1]!
	);
	const highest = $derived(Math.max(...data.weeks.map((w) => w.perDay), ADULT_KCAL) * 1.05);
	const farthest = $derived(Math.max(...data.weeks.map((w) => w.km), 1));
	const anyWalk = $derived(data.weeks.some((w) => w.km > 0));
	const thisWeek = $derived(data.weeks[data.weeks.length - 1]!.week);

	let all = $state(false);
	let showNotFood = $state(false);
	let editing = $state<string | null>(null);
	let problem = $state<string | null>(null);

	// While the AI estimates, the page asked again now and then.
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		clearTimeout(timer);
		if (data.estimating) timer = setTimeout(() => invalidateAll(), 8_000);
	});
	onDestroy(() => clearTimeout(timer));

	const shortDay = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});
	const km = (value: number) => `${value.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`;
	const number = (value: number) => value.toLocaleString('es-ES', { maximumFractionDigits: 0 });

	/** «1 ud ≈ 500 g · 250 kcal/100 g», or «al peso». */
	const estimateText = (e: { byWeight: boolean; grams: number; kcal100: number }) =>
		`${e.byWeight ? 'al peso' : `1 ud ≈ ${number(e.grams)} g`} · ${number(e.kcal100)} kcal/100 g`;

	const done =
		() =>
		async ({
			result,
			update
		}: {
			result: { type: string; data?: Record<string, unknown> };
			update: (o?: { reset?: boolean }) => Promise<void>;
		}) => {
			if (result.type === 'failure') problem = String(result.data?.message ?? 'No se pudo guardar');
			else if (result.type === 'success') {
				problem = null;
				editing = null;
			}
			await update({ reset: false });
		};

	const field =
		'w-24 rounded-md border-zinc-700 bg-zinc-950 py-1 text-sm focus:border-amber-500 focus:ring-amber-500';
	const button = 'rounded-md px-3 py-1.5 text-sm';
</script>

<svelte:head>
	<title>Calorías · Seilide</title>
</svelte:head>

{#snippet correction(p: (typeof data.products)[number])}
	<form
		method="post"
		action="?/correct"
		class="mt-2 flex flex-wrap items-end gap-3 rounded-md bg-zinc-900 p-3 text-sm"
		use:enhance={done}
	>
		<input type="hidden" name="text" value={p.key} />
		<label class="flex items-center gap-2">
			<input type="checkbox" name="food" checked={p.estimate?.food ?? true} />
			Es comida
		</label>
		<label class="flex items-center gap-2">
			<input type="checkbox" name="byWeight" checked={p.estimate?.byWeight ?? false} />
			Al peso (la cantidad son kg)
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-xs text-zinc-400">Gramos de una unidad</span>
			<input
				class={field}
				name="grams"
				inputmode="decimal"
				value={p.estimate ? Math.round(p.estimate.grams) : ''}
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-xs text-zinc-400">kcal por 100 g</span>
			<input
				class={field}
				name="kcal100"
				inputmode="decimal"
				value={p.estimate ? Math.round(p.estimate.kcal100) : ''}
			/>
		</label>
		<button class="{button} bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400"
			>Guardar</button
		>
		<button
			type="button"
			class="{button} bg-zinc-800 hover:bg-zinc-700"
			onclick={() => (editing = null)}>Cancelar</button
		>
	</form>
{/snippet}

<div class="mx-auto max-w-3xl">
	<h1 class="mb-3 text-2xl font-bold">
		Dinero<GuideLink page="dinero#calorías" label="las calorías" />
	</h1>
	<ExpenseTabs current="calorias" />

	<p class="mb-4 text-sm text-zinc-400">
		Las calorías de lo que compráis, por los tickets: cada producto lo estima la IA una vez y se
		puede corregir. No es lo que come cada uno (no todo se come, y no todo tiene ticket): sirve para
		ver cómo va de una semana a otra. Por persona, entre {peopleText(data.people)}{data.people
			.children
			? ` (un peque cuenta como ${String(CHILD_SHARE).replace('.', ',')})`
			: ''}.
	</p>

	{#if data.estimating || data.pending.products || data.problem}
		<p
			class={[
				'mb-4 rounded-md px-3 py-2 text-sm',
				data.problem && !data.estimating ? 'bg-red-950 text-red-200' : 'bg-zinc-900 text-zinc-300'
			]}
		>
			{#if data.estimating}
				Estimando los productos que faltan{data.pending.products
					? ` (${data.pending.products} de estas semanas)`
					: ''}… Esta página se pone al día sola.
			{:else if data.problem}
				No se pudieron estimar: {data.problem}
			{:else}
				Faltan {data.pending.products === 1 ? '1 producto' : `${data.pending.products} productos`}
				por estimar: vuelve en un rato.
			{/if}
		</p>
	{/if}

	<section class="mb-8 rounded-lg bg-zinc-900 p-4">
		<h2 class="mb-1 font-semibold">Al día, por persona</h2>
		<p class="mb-3 text-sm text-zinc-400">
			{#if data.recent !== null}
				Las últimas 4 semanas,
				<span class="font-semibold text-white tabular-nums">{kcal(data.recent)}</span>
				de media (un adulto necesita unas {number(ADULT_KCAL)}).
				{#if data.recent < ADULT_KCAL * 0.6}
					Muy por debajo: seguramente faltan tickets.
				{/if}
			{:else}
				Aún no hay tickets con comida estas semanas.
			{/if}
		</p>
		<p class="mb-2 text-sm text-zinc-400">
			Semana del {shortDay(shown.week)}{shown.week === thisWeek ? ' (va por aquí)' : ''}:
			<span class="font-semibold text-white tabular-nums">{kcal(shown.perDay)}</span>
			al día{#if anyWalk}
				· tus paseos, <span class="font-semibold text-sky-300 tabular-nums">{km(shown.km)}</span
				>{/if}
		</p>
		<div class="relative flex h-40 items-end gap-1">
			<div
				class="pointer-events-none absolute inset-x-0 border-t border-dashed border-zinc-400"
				style:bottom="{(ADULT_KCAL / highest) * 100}%"
			></div>
			{#each data.weeks as w (w.week)}
				<button
					class="flex h-full flex-1 items-end"
					aria-label="Semana del {shortDay(w.week)}: {kcal(w.perDay)} al día, {km(w.km)}"
					aria-pressed={w.week === shown.week}
					onclick={() => (picked = w.week)}
				>
					<span
						class={[
							'block w-full rounded-t',
							w.week === thisWeek ? 'bg-amber-500/50' : 'bg-amber-500',
							w.week === shown.week && 'ring-2 ring-white'
						]}
						style:height="{(w.perDay / highest) * 100}%"
					></span>
				</button>
			{/each}
		</div>
		{#if anyWalk}
			<p class="mt-3 mb-1 text-xs text-zinc-500">Tus paseos, km por semana</p>
			<div class="flex h-14 items-end gap-1">
				{#each data.weeks as w (w.week)}
					<button
						class="flex h-full flex-1 items-end"
						aria-label="Semana del {shortDay(w.week)}: {km(w.km)}"
						onclick={() => (picked = w.week)}
					>
						<span
							class={[
								'block w-full rounded-t',
								w.week === thisWeek ? 'bg-sky-500/50' : 'bg-sky-500',
								w.week === shown.week && 'ring-2 ring-white'
							]}
							style:height="{(w.km / farthest) * 100}%"
						></span>
					</button>
				{/each}
			</div>
		{/if}
		<div class="mt-1 flex gap-1 text-center text-[0.65rem] text-zinc-500">
			{#each data.weeks as w (w.week)}
				<span class="flex-1 truncate">{shortDay(w.week)}</span>
			{/each}
		</div>
		<p class="mt-3 text-xs text-zinc-500">
			La compra grande de una semana la sube y baja la siguiente: mejor mirar varias juntas. Tus
			paseos solo los ves tú.
		</p>
	</section>

	{#if data.tags.length}
		{@const largest = data.tags[0].kcal}
		<section class="mb-8">
			<h2 class="mb-1 font-semibold">De dónde vienen</h2>
			<p class="mb-3 text-sm text-zinc-400">
				Las {data.weeks.length} semanas, por la etiqueta de cada línea.
			</p>
			<ul class="flex flex-col gap-1.5">
				{#each data.tags as t (t.tag)}
					<li class="grid grid-cols-[8rem_1fr_auto] items-center gap-2 text-sm">
						<span class="truncate">{t.tag}</span>
						<span class="h-2 overflow-hidden rounded-full bg-zinc-800">
							<span
								class="block h-full rounded-full bg-amber-500"
								style:width="{(t.kcal / largest) * 100}%"
							></span>
						</span>
						<span class="text-right tabular-nums">{Math.round(t.share * 100)} %</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="mb-10">
		<h2 class="mb-1 font-semibold">Productos</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Los que más calorías suman estas semanas. Si la IA se equivocó con uno, corrígelo: vale para
			todos sus tickets, los de antes y los que vengan.
		</p>
		{#if problem}<p class="mb-2 text-sm text-red-300">{problem}</p>{/if}
		<ul class="divide-y divide-zinc-800">
			{#each all ? data.products : data.products.slice(0, SHOWN) as p (p.key)}
				<li class="py-2">
					<div class="flex items-center gap-3">
						<span class="min-w-0 flex-1">
							<span class="block truncate">{p.text}</span>
							<span class="block text-xs text-zinc-500"
								>{p.estimate ? estimateText(p.estimate) : ''}{p.estimate?.byHand
									? ' · corregido'
									: ''} · {p.count === 1 ? 'una vez' : `${p.count} veces`}</span
							>
						</span>
						<span class="text-right text-sm tabular-nums">{kcal(p.kcal)}</span>
						<button
							class="shrink-0 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs hover:bg-zinc-700"
							aria-expanded={editing === p.key}
							onclick={() => (editing = editing === p.key ? null : p.key)}>Corregir</button
						>
					</div>
					{#if editing === p.key}{@render correction(p)}{/if}
				</li>
			{:else}
				<li class="py-2 text-sm text-zinc-400">Ningún producto estimado estas semanas.</li>
			{/each}
		</ul>
		{#if !all && data.products.length > SHOWN}
			<button class="mt-2 text-sm text-amber-300 hover:underline" onclick={() => (all = true)}
				>Ver los {data.products.length}</button
			>
		{/if}

		{#if data.notFood.length}
			<button
				class="mt-4 block text-sm text-zinc-400 hover:text-white"
				aria-expanded={showNotFood}
				onclick={() => (showNotFood = !showNotFood)}
				>{showNotFood ? '▾' : '▸'} No cuentan como comida ({data.notFood.length})</button
			>
			{#if showNotFood}
				<ul class="mt-1 divide-y divide-zinc-800">
					{#each data.notFood as p (p.key)}
						<li class="py-2">
							<div class="flex items-center gap-3">
								<span class="min-w-0 flex-1 truncate text-sm">{p.text}</span>
								<button
									class="shrink-0 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs hover:bg-zinc-700"
									aria-expanded={editing === p.key}
									onclick={() => (editing = editing === p.key ? null : p.key)}>Corregir</button
								>
							</div>
							{#if editing === p.key}{@render correction(p)}{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>
</div>

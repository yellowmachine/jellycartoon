<script lang="ts">
	import ExpenseTabs from '#lib/components/ExpenseTabs.svelte';
	import { billDays } from 'comun/bills.ts';
	import { euros } from 'comun/expenses.ts';
	import type { TariffOffer } from 'comun/bill-simulation.ts';
	import { primary, select } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	/**
	 * «¿Y si…?» (#232): each light bill with the tariff it says and with up to two typed in, and the
	 * last year's sums (bill-simulation.ts).
	 */
	let { data }: PageProps = $props();
	const sim = $derived(data.simulation);
	const own = $derived(data.own);
	/** Where «Tu tarifa» is in the results: first, when the bills say it. */
	const ownIndex = $derived(own ? 0 : -1);

	const price = (n: number, digits = 4) =>
		n.toLocaleString('es-ES', { maximumFractionDigits: digits });
	const energyText = (e: TariffOffer['energy']) =>
		e.kind === 'fijo'
			? `${price(e.price)} €/kWh a todas horas`
			: `punta ${price(e.P1)}, llano ${price(e.P2)}, valle ${price(e.P3)} €/kWh`;

	const shortDay = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			day: 'numeric',
			month: 'short',
			year: '2-digit',
			timeZone: 'UTC'
		});

	/** Against «Tu tarifa» worked out the same way: what changing would have saved (green) or cost. */
	function diff(cents: number | null, base: number | null) {
		if (cents === null || base === null) return null;
		const d = cents - base;
		return { text: `${d > 0 ? '+' : d < 0 ? '−' : '±'}${euros(Math.abs(d))}`, cheaper: d < 0 };
	}

	/** The latest bill that could be worked out with its own tariff: how near the sum is. */
	const check = $derived.by(() => {
		if (ownIndex < 0) return null;
		const b = sim.bills.find((x) => x.offers[ownIndex]?.cents !== null);
		return b ? { paid: b.paid, worked: b.offers[ownIndex]!.cents! } : null;
	});

	const asked = $derived(data.asked as Record<string, string>);
	const value = (key: string) => asked[key] ?? '';
	const defaultPower = (p: 'P1' | 'P2') => (own ? price(own.powerPrice[p], 6) : '');
	let kinds = $state<Record<string, string>>({});
	const kindOf = (prefix: string) => kinds[prefix] ?? (asked[`${prefix}tipo`] || 'fijo');

	const input =
		'w-full rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm text-zinc-100 focus:border-amber-400 focus:ring-amber-400';
</script>

<svelte:head>
	<title>¿Y si…? · Facturas · Seilide</title>
</svelte:head>

<ExpenseTabs current="facturas" />

<div class="mx-auto max-w-3xl">
	<p class="mb-2 text-sm">
		<a href="/gastos/facturas" class="text-zinc-400 hover:text-white">← Facturas</a>
	</p>
	<h1 class="mb-1 text-2xl font-bold">¿Y si…?</h1>
	<p class="mb-6 text-sm text-zinc-400">
		Cuánto habrías pagado de luz con otra tarifa, con lo que dicen tus facturas: lo consumido (en
		punta, llano y valle) y la potencia contratada, con el contador, el bono social y los impuestos.
		Pon los precios de una oferta sin impuestos, como vienen en las comparativas.
	</p>

	{#if !sim.bills.length}
		<p class="text-zinc-400">
			Sin facturas de la luz todavía: sube alguna en Gastos y aquí se calcula con ellas.
		</p>
	{:else}
		<section class="mb-6 rounded-lg bg-zinc-900 p-4 text-sm">
			<h2 class="text-zinc-400">Tu tarifa, como dice la última factura</h2>
			{#if own}
				<p class="mt-1">
					{energyText(own.energy)}; potencia {price(own.powerPrice.P1, 6)} y {price(
						own.powerPrice.P2,
						6
					)} €/kW·día (punta y valle).
				</p>
				{#if check}
					<p class="mt-1 text-xs text-zinc-500">
						Calculada así, la última sale {euros(check.worked)}, y pagaste {euros(check.paid)}: la
						diferencia es lo que tu compañía suma o descuenta aparte (cuotas, seguros, descuentos).
					</p>
				{/if}
			{:else}
				<p class="mt-1 text-zinc-400">
					Tus facturas no dicen el precio de la energía y de la potencia: con una leída de nuevo,
					sí. Las ofertas se calculan igual.
				</p>
			{/if}
		</section>

		<form method="get" class="mb-8 grid gap-4 sm:grid-cols-2">
			{#each ['a_', 'b_'] as prefix (prefix)}
				<fieldset class="space-y-2 rounded-lg border border-zinc-800 p-4 text-sm">
					<legend class="px-1 font-semibold">{prefix === 'a_' ? 'Oferta A' : 'Oferta B'}</legend>
					<input
						name="{prefix}nombre"
						value={value(`${prefix}nombre`)}
						placeholder="Su nombre (opcional)"
						maxlength="40"
						class={input}
					/>
					<div class="flex gap-3">
						{#each [['fijo', 'Precio fijo'], ['periodos', 'Por periodos']] as [k, label] (k)}
							<label class="flex items-center gap-1">
								<input
									type="radio"
									name="{prefix}tipo"
									value={k}
									checked={kindOf(prefix) === k}
									onchange={() => (kinds[prefix] = k)}
								/>
								{label}
							</label>
						{/each}
					</div>
					{#if kindOf(prefix) === 'periodos'}
						<div class="grid grid-cols-3 gap-2">
							{#each [['p1', 'Punta'], ['p2', 'Llano'], ['p3', 'Valle']] as [p, label] (p)}
								<label class="text-xs text-zinc-400"
									>{label} €/kWh
									<input
										name="{prefix}{p}"
										inputmode="decimal"
										value={value(`${prefix}${p}`)}
										class={input}
									/></label
								>
							{/each}
						</div>
					{:else}
						<label class="block text-xs text-zinc-400"
							>Energía €/kWh
							<input
								name="{prefix}precio"
								inputmode="decimal"
								value={value(`${prefix}precio`)}
								placeholder="0,12"
								class={input}
							/></label
						>
					{/if}
					<div class="grid grid-cols-3 items-end gap-2">
						<label class="text-xs text-zinc-400"
							>Potencia punta
							<input
								name="{prefix}pp1"
								inputmode="decimal"
								value={value(`${prefix}pp1`) || defaultPower('P1')}
								class={input}
							/></label
						>
						<label class="text-xs text-zinc-400"
							>Potencia valle
							<input
								name="{prefix}pp2"
								inputmode="decimal"
								value={value(`${prefix}pp2`) || defaultPower('P2')}
								class={input}
							/></label
						>
						<select name="{prefix}unidad" aria-label="Precio de la potencia por" class={select}>
							{#each [['dia', '€/kW·día'], ['mes', '€/kW·mes'], ['año', '€/kW·año']] as [u, label] (u)}
								<option value={u} selected={(asked[`${prefix}unidad`] || 'dia') === u}
									>{label}</option
								>
							{/each}
						</select>
					</div>
					<div class="grid grid-cols-3 gap-2">
						<label class="text-xs text-zinc-400"
							>kW punta
							<input
								name="{prefix}kw1"
								inputmode="decimal"
								value={value(`${prefix}kw1`)}
								placeholder="los tuyos"
								class={input}
							/></label
						>
						<label class="text-xs text-zinc-400"
							>kW valle
							<input
								name="{prefix}kw2"
								inputmode="decimal"
								value={value(`${prefix}kw2`)}
								placeholder="los tuyos"
								class={input}
							/></label
						>
						<label class="text-xs text-zinc-400"
							>Cuota €/mes
							<input
								name="{prefix}cuota"
								inputmode="decimal"
								value={value(`${prefix}cuota`)}
								placeholder="0"
								class={input}
							/></label
						>
					</div>
				</fieldset>
			{/each}
			<div class="sm:col-span-2">
				<button class={primary}>Calcular</button>
			</div>
		</form>

		{#if data.offers.length}
			<section class="mb-8">
				<h2 class="mb-2 font-semibold">El último año</h2>
				<p class="mb-3 text-sm text-zinc-400">
					{sim.year.bills}
					{sim.year.bills === 1 ? 'factura' : 'facturas'}, {sim.year.days} días{#if sim.year.days < 330}:
						con más facturas subidas, el año sale entero{/if}. Pagado: {euros(sim.year.paid)}.
				</p>
				<ul class="grid gap-2 sm:grid-cols-3">
					{#each data.offers as offer, i (i)}
						{@const total = sim.year.offers[i] ?? null}
						{@const d = i === ownIndex ? null : diff(total, sim.year.offers[ownIndex] ?? null)}
						<li class="rounded-lg bg-zinc-900 p-3 text-sm">
							<span class="block text-zinc-400">{offer.name}</span>
							<span class="block text-lg font-semibold tabular-nums"
								>{total === null ? '—' : euros(total)}</span
							>
							{#if d}
								<span class={d.cheaper ? 'text-green-400' : 'text-amber-400'}
									>{d.text} {d.cheaper ? 'menos' : 'más'}</span
								>
							{:else if total === null}
								<span class="text-xs text-zinc-500">alguna factura no dice lo necesario</span>
							{/if}
						</li>
					{/each}
				</ul>
			</section>

			<section class="mb-8 overflow-x-auto">
				<h2 class="mb-2 font-semibold">Factura a factura</h2>
				<table class="w-full text-sm">
					<thead class="text-left text-xs text-zinc-500">
						<tr>
							<th class="py-1 pr-2 font-normal">Periodo</th>
							<th class="py-1 pr-2 text-right font-normal">Pagado</th>
							{#each data.offers as offer, i (i)}
								<th class="py-1 pr-2 text-right font-normal">{offer.name}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each sim.bills as b (b.id)}
							<tr class="border-t border-zinc-800">
								<td class="py-1.5 pr-2"
									>{shortDay(b.periodStart)} – {shortDay(b.periodEnd)}
									<span class="text-xs text-zinc-500">· {billDays(b)} d</span></td
								>
								<td class="py-1.5 pr-2 text-right tabular-nums">{euros(b.paid)}</td>
								{#each b.offers as r, i (i)}
									<td class="py-1.5 pr-2 text-right tabular-nums" title={r.missing ?? undefined}
										>{r.cents === null ? '—' : euros(r.cents)}</td
									>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="mt-2 text-xs text-zinc-500">
					«—»: esa factura no dice lo necesario (lo consumido en cada periodo, o la potencia). Las
					diferencias son frente a tu tarifa calculada igual, no frente a lo pagado.
				</p>
			</section>
		{/if}
	{/if}
</div>

<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import { SURE_DAYS } from '#lib/energy-forecast.ts';
	import { euroText } from '#lib/plugs.ts';
	import { FACINGS, facingName, MAX_GROUPS, PERFORMANCE } from '#lib/solar.ts';
	import type { SolarState } from '#lib/server/energy/solar.ts';

	/**
	 * Solar panels and battery (Energía → Previsión, #513 phase 3): what they will make with the sun
	 * to come, what the grid will still give, whether the battery carries the night, and the best
	 * hours for appliances; and the panels as the family says them.
	 */
	let { s, problem = null }: { s: SolarState; problem?: string | null } = $props();
	const f = $derived(typeof s.forecast === 'object' ? s.forecast : null);
	const days = $derived(f?.days ?? []);
	const battery = $derived(s.row.batteryKwh);
	const kwp = $derived(s.row.groups.reduce((t, g) => t + g.kwp, 0));

	const n0 = (n: number) => Math.round(n).toLocaleString('es-ES');
	const n1 = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });
	const n2 = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
	const shortDay = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			weekday: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	const sum = (pick: (d: (typeof days)[number]) => number) => days.reduce((t, d) => t + pick(d), 0);
	const top = $derived(Math.max(1, ...days.map((d) => Math.max(d.made, d.used))));

	/** Today or tomorrow with sun to spare, and whether the day after is worse. */
	const advice = $derived.by(() => {
		const i = days.slice(0, 2).findIndex((d) => d.spare);
		if (i < 0) return null;
		const d = days[i]!;
		const next = days[i + 1];
		return {
			when: i === 0 ? 'Hoy' : 'Mañana',
			spare: d.spare!,
			worseAfter: !!next && next.made < d.made * 0.5
		};
	});

	let settings = $state(false);
	$effect.pre(() => {
		if (f && f.use.by === null) settings = true;
	});
	const groups = $derived(
		s.row.groups.length < MAX_GROUPS ? [...s.row.groups, null] : s.row.groups
	);
	const field = 'rounded-md border-zinc-700 bg-zinc-950 py-1 text-sm';
</script>

<section class="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
	<div class="flex items-baseline justify-between gap-2">
		<h3 class="font-semibold">☀️ Placas solares</h3>
		<button class="text-xs text-zinc-500 hover:text-white" onclick={() => (settings = !settings)}
			>{settings ? 'Cerrar' : 'Ajustes'}</button
		>
	</div>
	<p class="text-xs text-zinc-500">
		{n1(kwp)} kWp{#each s.row.groups as g, i (i)}{s.row.groups.length > 1
				? `${i ? ',' : ':'} ${n1(g.kwp)} al ${facingName(g.azimuth).toLowerCase()}`
				: ` al ${facingName(g.azimuth).toLowerCase()}, ${g.tilt}°`}{/each}{#if battery}; batería de {n1(
				battery
			)} kWh{:else}; sin batería{/if}.
	</p>

	{#if typeof s.forecast === 'string'}
		<p class="mt-2 text-sm text-zinc-400">{s.forecast}</p>
	{:else if f && f.use.by === null}
		<p class="mt-2 text-sm text-zinc-300">
			Para saber lo que darán y si {battery ? 'la batería llega a la noche' : 'tiraréis de la red'},
			hace falta lo que gasta la casa entera al día. Ponlo abajo (la app del inversor lo enseña,
			«consumo» del día), o di desde cuándo tenéis placas y lee en Dinero las facturas de la luz de
			antes{#if f.use.bills}{' '}(llevas {f.use.bills.have} de {f.use.bills.need}){/if}: las de
			después solo dicen lo que viene de la red.
		</p>
	{:else if f && days.length}
		<p class="mt-2 text-2xl font-semibold text-zinc-100 tabular-nums">
			unos {n0(sum((d) => d.made))} kWh de las placas
		</p>
		<p class="text-sm text-zinc-400 tabular-nums">
			en {days.length} días: de la red, unos {n0(sum((d) => d.fromGrid))} kWh{#if f.price}
				({euroText(sum((d) => d.fromGrid) * f.price)}){/if}; sobrarán {n0(sum((d) => d.toGrid))} kWh para
			la red.
		</p>

		{#if advice}
			<p class="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				{advice.when} sobra sol de {advice.spare.from} a {advice.spare.to} (unos {n0(
					advice.spare.kwh
				)} kWh): buen momento para la lavadora, el lavavajillas o el termo{#if advice.worseAfter};
					el día siguiente dará menos de la mitad{/if}.
			</p>
		{/if}

		<table class="mt-3 w-full text-sm tabular-nums">
			<thead class="text-xs text-zinc-500">
				<tr>
					<th class="text-left font-normal">Día</th>
					<th class="font-normal"><span class="sr-only">Placas y casa</span></th>
					<th class="pl-2 text-right font-normal">Placas</th>
					<th class="pl-2 text-right font-normal">Red</th>
					{#if battery}<th class="pl-2 text-left font-normal">Batería</th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each days as d, i (d.day)}
					<tr class={i >= SURE_DAYS ? 'text-zinc-500' : 'text-zinc-300'}>
						<td class="py-0.5 pr-2 whitespace-nowrap">{i === 0 ? 'hoy' : shortDay(d.day)}</td>
						<td
							class="w-full py-0.5"
							title="{n1(d.made)} kWh de las placas, {n1(d.used)} de la casa"
						>
							<div
								class="h-2 rounded-sm bg-amber-400 {i >= SURE_DAYS ? 'opacity-50' : ''}"
								style:width="{(d.made / top) * 100}%"
							></div>
							<div
								class="mt-0.5 h-1 rounded-sm bg-zinc-500"
								style:width="{(d.used / top) * 100}%"
							></div>
						</td>
						<td class="pl-2 text-right whitespace-nowrap">{n0(d.made)}</td>
						<td class="pl-2 text-right whitespace-nowrap">{n0(d.fromGrid)}</td>
						{#if battery}
							<td class="pl-2 text-xs whitespace-nowrap">
								{#if d.emptyAt === null}llega{:else if d.emptyAt < 12}a las {d.emptyAt} de madrugada{:else}a
									las {d.emptyAt}{/if}
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="mt-1 text-xs text-zinc-500">
			kWh de cada día. Barra amarilla, lo que dan las placas; gris, lo que gasta la casa.
			{#if battery}«Batería»: si llega hasta el sol de la mañana siguiente, o a qué hora se acaba.{/if}
		</p>

		<p class="mt-3 text-xs text-zinc-500">
			{#if f.use.by === 'dicho'}
				Con lo que dijiste que gasta la casa: unos {n1(f.use.kwh)} kWh al día.
			{:else if f.use.by === 'facturas'}
				Lo que gasta la casa, aprendido de {f.use.fit.n} facturas de antes de las placas:
				{#if f.use.fit.perDegree > 0}
					{n1(f.use.fit.base)} kWh al día sin frío y {n2(f.use.fit.perDegree)} más por cada grado-día.
				{:else}
					unos {n1(f.use.fit.base)} kWh al día.
				{/if}
			{/if}
			El sol, el que prevé Open-Meteo sobre tus paneles con su inclinación y orientación; de cada 100
			llegan unos {n0(PERFORMANCE * 100)} a casa (calor, inversor, cables). Lo que gasta, repartido por
			horas como una casa española (el perfil oficial del BOE). No sé cómo está la batería ahora: hoy
			es el día menos seguro.
			{#if !f.price}Sin precio del kWh: ponlo en Enchufes o lee una factura de la luz.{/if}
		</p>
	{/if}

	{#if settings}
		<form
			method="post"
			action="?/saveSolar"
			use:enhance={() =>
				async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') settings = false;
				}}
			class="mt-4 flex flex-col gap-3 border-t border-zinc-800 pt-3 text-sm"
		>
			<fieldset class="flex flex-col gap-2">
				<legend class="mb-1 text-zinc-400">
					Los paneles: kWp, inclinación y hacia dónde miran. Si miran a dos lados, cada uno en su
					línea.
				</legend>
				{#each groups as g, i (i)}
					<div class="flex items-center gap-2">
						<label class="flex items-center gap-1">
							<input
								type="number"
								name="kwp{i}"
								value={g?.kwp ?? ''}
								min="0"
								max="100"
								step="0.01"
								class="w-16 {field}"
							/>
							kWp
						</label>
						<label class="flex items-center gap-1">
							<input
								type="number"
								name="tilt{i}"
								value={g?.tilt ?? 30}
								min="0"
								max="90"
								aria-label="Inclinación"
								class="w-14 {field}"
							/>
							°
						</label>
						<select name="azimuth{i}" class="min-w-0 flex-1 {field}" aria-label="Hacia dónde miran">
							{#each FACINGS as fc (fc.azimuth)}
								<option value={fc.azimuth} selected={(g?.azimuth ?? 0) === fc.azimuth}
									>{fc.name}</option
								>
							{/each}
						</select>
					</div>
				{/each}
				<p class="text-xs text-zinc-500">
					Los kWp vienen en el contrato o en la app del inversor (paneles × vatios de cada uno ÷
					1000). En un tejado, unos 30°.
				</p>
			</fieldset>
			<div class="grid grid-cols-2 gap-3">
				{#snippet amount(
					label: string,
					name: string,
					value: number | null,
					unit: string,
					max: number,
					step = 0.1
				)}
					<label class="flex flex-col gap-1 text-xs text-zinc-400">
						{label}
						<span class="flex items-center gap-1 text-sm text-zinc-200">
							<input
								type="number"
								{name}
								value={value ?? ''}
								min="0"
								{max}
								{step}
								class="w-20 {field}"
							/>
							{unit}
						</span>
					</label>
				{/snippet}
				{@render amount('Inversor', 'inverterKw', s.row.inverterKw, 'kW', 200)}
				{@render amount('Batería', 'batteryKwh', s.row.batteryKwh, 'kWh', 200)}
				{@render amount('Reserva de la batería', 'reserve', s.row.reserve, '%', 90, 1)}
				{@render amount('La casa gasta al día', 'dayKwh', s.row.dayKwh, 'kWh', 200)}
				<label class="col-span-2 flex flex-col gap-1 text-xs text-zinc-400">
					Tenemos placas desde
					<input
						type="date"
						name="installedOn"
						value={s.row.installedOn ?? ''}
						class="w-44 {field} text-zinc-200"
					/>
				</label>
			</div>
			<p class="text-xs text-zinc-500">
				Inversor y batería: vacíos si no lo sabes o no hay. Lo que gasta la casa entera lo enseña la
				app del inversor; si no lo pones, se aprende de las facturas de la luz de antes de las
				placas.
			</p>
			{#if problem}<p class="text-sm text-red-400">{problem}</p>{/if}
			<div class="flex gap-2">
				<button class="rounded-md bg-amber-600 px-3 py-1 text-zinc-950 hover:bg-amber-500"
					>Guardar</button
				>
			</div>
		</form>
		<div class="mt-2">
			<ConfirmForm
				action="?/removeSolar"
				fields={{}}
				label="Quitar las placas"
				question="¿Quitar las placas? Se olvida lo que dijiste de ellas."
				class="text-xs text-zinc-500 hover:text-red-400"
			/>
		</div>
	{/if}
</section>

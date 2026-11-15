<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import { FUEL_KINDS, MIN_UNITS, WINTER_DEGREES } from '#lib/fuel.ts';
	import type { FuelState } from '#lib/server/energy/fuel.ts';

	/**
	 * Butane or pellet (Energía → Previsión, #513 phase 2): what is at home, how long it lasts with
	 * the cold to come, the expenses in Dinero that look like a purchase, and its settings.
	 */
	let { f }: { f: FuelState } = $props();
	const meta = $derived(FUEL_KINDS[f.kind]);
	const o = $derived(f.outlook);

	const dayName = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			weekday: 'long',
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});
	const plural = (n: number) => (n === 1 ? meta.unit : meta.units);
	const n0 = (n: number) => Math.round(n).toLocaleString('es-ES');
	/** «unas 2 bombonas (entre 1 y 3)», or one figure when the range is no range. */
	function neededText(n: { kwh: number; low: number; high: number }) {
		const [mid, low, high] = [n.kwh, n.low, n.high].map((x) => Math.max(0, Math.round(x)));
		if (!high) return 'casi nada';
		const some = (k: number) => (k <= 1 ? `una ${meta.unit}` : `unas ${k} ${meta.units}`);
		return low === high ? some(low) : `${some(mid)} (entre ${low} y ${high})`;
	}
	let settings = $state(false);
	const button =
		'rounded-md border border-zinc-700 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800';
</script>

<section class="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
	<div class="flex items-baseline justify-between gap-2">
		<h3 class="font-semibold">{meta.icon} {meta.name}</h3>
		<button class="text-xs text-zinc-500 hover:text-white" onclick={() => (settings = !settings)}
			>{settings ? 'Cerrar' : 'Ajustes'}</button
		>
	</div>

	<p class="mt-1 text-sm text-zinc-300">
		{#if f.startedOn}
			La {meta.unit} de ahora, empezada el {dayName(
				f.startedOn
			)}{#if o?.left !== null && o?.left !== undefined}: le queda más o menos un {n0(o.left * 100)} %{/if}.
		{:else}
			Aún no sé cuándo empezaste la de ahora.
		{/if}
		{#if f.full}Y {f.full} {f.full === 1 ? 'llena' : 'llenas'} en casa.{/if}
	</p>

	{#if o && f.startedOn}
		<p class="mt-2 text-lg font-semibold text-zinc-100">
			{#if o.allEnds}
				{f.full ? 'Lo que hay en casa llega' : `Te llega`} hasta el {dayName(o.allEnds)}
			{:else}
				Te llega para más de dos semanas
			{/if}
		</p>
		{#if o.currentEnds && f.full}
			<p class="text-sm text-zinc-400">La de ahora, hasta el {dayName(o.currentEnds)}.</p>
		{/if}
		<p class="text-sm text-zinc-400">
			En los próximos 15 días, {neededText(o.needed)}{#if o.toBuy}; {f.startsOnBuy
					? 'tendrás que pedir'
					: 'compra'}
				{o.toBuy}
				{plural(o.toBuy)}{/if}.
		</p>
	{/if}

	<p class="mt-2 text-xs text-zinc-500">
		{#if f.by === 'aprendido' && f.fit}
			Aprendido de {f.learnedFrom}
			{plural(f.learnedFrom)}: con frío de invierno ({WINTER_DEGREES} grados-día) te dura unos {n0(
				1 / (f.fit.base + f.fit.perDegree * WINTER_DEGREES)
			)} días.
		{:else if f.by === 'dicho'}
			Con lo que dijiste (unos {f.guessDays} días en invierno) hasta que aprenda de {MIN_UNITS}
			{meta.units} enteras (llevas {f.learnedFrom}).
		{:else}
			Para calcularlo, dime en Ajustes cuánto te dura una {meta.unit} en invierno, o espera a que aprenda
			de {MIN_UNITS}
			{meta.units} enteras (llevas {f.learnedFrom}).
		{/if}
		{#if f.startsOnBuy}
			Cada {meta.unit} apuntada en Gastos cuenta como puesta ese día.
		{/if}
	</p>

	{#each f.pending as e (e.id)}
		<div class="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
			<p>
				En Gastos, el {dayName(e.date)}: {e.store}, {e.total}. ¿Es {meta.unit === 'bombona'
					? 'una bombona'
					: 'pellet'}?
			</p>
			<form
				method="post"
				action="?/bought"
				use:enhance
				class="mt-2 flex flex-wrap items-center gap-2"
			>
				<input type="hidden" name="id" value={f.id} />
				<input type="hidden" name="day" value={e.date} />
				<input type="hidden" name="expense" value={e.id} />
				<label class="flex items-center gap-1 text-zinc-300"
					>Sí,
					<input
						type="number"
						name="quantity"
						value="1"
						min="1"
						max="50"
						class="w-16 rounded-md border-zinc-700 bg-zinc-950 py-1 text-sm"
					/>
					{meta.units}</label
				>
				<button class="rounded-md bg-amber-600 px-3 py-1 text-sm text-white hover:bg-amber-500"
					>Apuntar</button
				>
				<button
					name="quantity"
					value="0"
					class="rounded-md px-3 py-1 text-sm text-zinc-400 hover:bg-zinc-800">No es</button
				>
			</form>
		</div>
	{/each}

	<div class="mt-3 flex flex-wrap gap-2">
		<form method="post" action="?/started" use:enhance>
			<input type="hidden" name="id" value={f.id} />
			<button class={button}>He empezado una hoy</button>
		</form>
		{#if !f.startsOnBuy}
			<form method="post" action="?/bought" use:enhance class="flex items-center gap-1">
				<input type="hidden" name="id" value={f.id} />
				<input
					type="number"
					name="quantity"
					value="1"
					min="1"
					max="50"
					aria-label="Cuántos"
					class="w-16 rounded-md border-zinc-700 bg-zinc-950 py-1 text-sm"
				/>
				<button class={button}>He comprado</button>
			</form>
		{/if}
	</div>

	{#if settings}
		<form
			method="post"
			action="?/saveFuel"
			use:enhance={() =>
				async ({ update }) => {
					await update({ reset: false });
					settings = false;
				}}
			class="mt-4 flex flex-col gap-3 border-t border-zinc-800 pt-3 text-sm"
		>
			<input type="hidden" name="id" value={f.id} />
			<label class="flex items-center gap-2">
				<input type="checkbox" name="startsOnBuy" checked={f.startsOnBuy} />
				La pongo nada más comprarla (cambio la vacía por una llena)
			</label>
			<label class="flex items-center gap-2">
				En invierno me dura unos
				<input
					type="number"
					name="guessDays"
					value={f.guessDays ?? ''}
					min="1"
					max="120"
					class="w-16 rounded-md border-zinc-700 bg-zinc-950 py-1 text-sm"
				/>
				días
			</label>
			<label class="flex items-center gap-2">
				Avisar
				<input
					type="number"
					name="alertDays"
					value={f.alertDays}
					min="1"
					max="14"
					class="w-16 rounded-md border-zinc-700 bg-zinc-950 py-1 text-sm"
				/>
				días antes de que se acabe
			</label>
			<div class="flex gap-2">
				<button class="rounded-md bg-amber-600 px-3 py-1 text-white hover:bg-amber-500"
					>Guardar</button
				>
			</div>
		</form>
		<div class="mt-2">
			<ConfirmForm
				action="?/removeFuel"
				fields={{ id: f.id }}
				label="Quitar {meta.name.toLowerCase()}"
				question="¿Quitar {meta.name.toLowerCase()}? Se olvida lo apuntado y lo aprendido; los gastos de Dinero se quedan."
				class="text-xs text-zinc-500 hover:text-red-400"
			/>
		</div>
	{/if}
</section>

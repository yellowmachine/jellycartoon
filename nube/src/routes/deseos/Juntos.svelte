<!--
@component
«Seleccionar» → bought together (#586): one expense for each shop, with what was paid there; or only
marked as bought.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { EXPENSE_CATEGORIES, monthOf } from 'comun/expenses.ts';
	import { sameText, type LooksSame } from 'comun/page-notices.ts';
	import { field, primary, secondary } from '#lib/styles.ts';
	import { amountField, togetherTotal, type Bought } from '#lib/wishes.ts';

	interface Props {
		list: (Bought & { id: number; shop: string })[];
		today: string;
		/** Any of them, another adult's gift: they see Dinero too. */
		secret: boolean;
		onbought: (done: { expense: number | null; month: string }) => void;
		oncancel: () => void;
	}
	let { list, today, secret, onbought, oncancel }: Props = $props();

	let date = $state(untrack(() => today));
	let category = $state('Otros');
	let saving = $state(false);
	let problem = $state<string | null>(null);
	let repeated = $state<LooksSame | null>(null);

	const groups = $derived(
		[...new Set(list.map((w) => w.shop))].map((shop) => {
			const those = list.filter((w) => w.shop === shop);
			return { shop, count: those.length, total: togetherTotal(those) };
		})
	);
	/** As written; a shop not touched, what its products add up to. */
	let prices = $state<Record<string, string>>({});
	let stores = $state<Record<string, string>>({});
	const changed = () => (repeated = null);
</script>

<form
	method="post"
	action="?/buyTogether"
	class="mb-3 flex max-h-[60dvh] flex-col gap-3 overflow-y-auto text-sm"
	use:enhance={() => {
		saving = true;
		problem = null;
		const month = monthOf(date);
		return async ({ result, update }) => {
			saving = false;
			if (result.type === 'success') {
				const expenses = (result.data?.expenses ?? []) as number[];
				await update({ reset: false });
				onbought({ expense: expenses[0] ?? null, month });
			} else if (result.type === 'failure' && result.data?.repeated)
				repeated = result.data.repeated as LooksSame;
			else
				problem =
					result.type === 'failure'
						? String(result.data?.message ?? 'No se pudo guardar')
						: 'No se pudo guardar';
		};
	}}
>
	<input type="hidden" name="ids" value={list.map((w) => w.id).join(',')} />
	{#if repeated}<input type="hidden" name="igual" value="1" />{/if}
	<p class="text-zinc-300">
		{groups.length > 1
			? `Un gasto por tienda (${groups.length}), con lo pagado en cada una:`
			: 'Un solo gasto, con lo que has pagado en total:'}
	</p>
	{#each groups as g (g.shop)}
		<div class="flex gap-2">
			<input type="hidden" name="shop" value={g.shop} />
			<label class="min-w-0 flex-1 text-xs text-zinc-400">
				Tienda · {g.count === 1 ? '1 producto' : `${g.count} productos`}
				<input
					name="store"
					maxlength="120"
					bind:value={() => stores[g.shop] ?? g.shop, (v) => (stores[g.shop] = v)}
					oninput={changed}
					class="{field} mt-1 py-1 text-sm"
				/>
			</label>
			<label class="w-28 text-xs text-zinc-400">
				Pagado (€)
				<input
					name="price"
					inputmode="decimal"
					placeholder="12,30"
					bind:value={() => prices[g.shop] ?? amountField(g.total), (v) => (prices[g.shop] = v)}
					oninput={changed}
					class="{field} mt-1 py-1 text-sm"
				/>
			</label>
		</div>
		{#if g.total === null}
			<p class="-mt-2 text-xs text-zinc-400">
				Alguno no tiene precio en euros: escribe lo que has pagado en {g.shop}.
			</p>
		{/if}
	{/each}
	<div class="flex gap-2">
		<label class="flex-1 text-xs text-zinc-400">
			Fecha
			<input
				type="date"
				name="date"
				required
				bind:value={date}
				oninput={changed}
				class="{field} mt-1 py-1 text-sm"
			/>
		</label>
		<label class="flex-1 text-xs text-zinc-400">
			Categoría
			<select name="category" bind:value={category} class="{field} mt-1 py-1 text-sm">
				{#each EXPENSE_CATEGORIES as c (c)}<option>{c}</option>{/each}
			</select>
		</label>
	</div>
	{#if secret}
		<p class="text-xs text-amber-200">
			Hay un regalo: en Dinero la familia verá la tienda y el importe, no qué es.
		</p>
	{/if}
	{#if repeated}
		<div class="rounded-md border border-amber-500/40 bg-amber-950/40 p-2 text-xs" role="alert">
			<p class="text-amber-200">{sameText(repeated, today)} ¿Lo guardo igual?</p>
			<a
				href="/gastos?mes={monthOf(repeated.date)}&gasto={repeated.id}"
				target="_blank"
				class="text-amber-400 hover:underline">Ver el otro</a
			>
		</div>
	{/if}
	{#if problem}<p class="text-red-400" role="alert">{problem}</p>{/if}
	<div class="flex flex-wrap gap-2">
		<button class={primary} disabled={saving}
			>{saving ? 'Guardando…' : repeated ? 'Guardar igual' : 'Añadir a Dinero'}</button
		>
		<button name="solo" value="1" class={secondary} disabled={saving}
			>Solo marcar como comprados</button
		>
		<button type="button" class={secondary} onclick={oncancel}>Cancelar</button>
	</div>
</form>

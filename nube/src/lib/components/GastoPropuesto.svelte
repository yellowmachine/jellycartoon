<!--
@component
An expense a rule proposes (#600), under its event in the Agenda or in the Buzón: «Añadir a Dinero»,
«Cambiar» and «No». Posts to the page's `?/gasto`.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { dayName } from 'comun/agenda.ts';
	import { euros, monthOf, parseEuros } from 'comun/expenses.ts';
	import { sameText, type LooksSame } from 'comun/page-notices.ts';
	import ExpenseFields from './ExpenseFields.svelte';
	import { primary, secondary } from '#lib/styles.ts';
	import type { WaitingExpense } from '#lib/server/expense-proposals.ts';

	interface Props {
		waiting: WaitingExpense;
		today: string;
		onadded?: (added: { expense: number; month: string }) => void;
	}
	let { waiting, today, onadded }: Props = $props();

	const p = untrack(() => waiting.proposal);
	let date = $state(p.day);
	let price = $state((p.total / 100).toFixed(2).replace('.', ','));
	let store = $state(p.store);
	let category = $state<string>(p.category);
	let changing = $state(false);
	let saving = $state(false);
	let problem = $state<string | null>(null);
	/** Said before touching anything, if it is there already (the bank's). */
	let repeated = $state<LooksSame | null>(untrack(() => waiting.repeated));
</script>

<form
	method="post"
	action="?/gasto"
	class="mt-1 flex max-w-sm flex-col gap-2 rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm"
	use:enhance={() => {
		saving = true;
		problem = null;
		return async ({ result, update }) => {
			saving = false;
			if (result.type === 'success') {
				if (result.data?.expense)
					onadded?.({ expense: Number(result.data.expense), month: String(result.data.month) });
				await update({ reset: false });
			} else if (result.type === 'failure' && result.data?.repeated)
				repeated = result.data.repeated as LooksSame;
			else if (result.type === 'failure')
				problem = String(result.data?.message ?? 'No se pudo guardar');
			else problem = 'No se pudo guardar';
		};
	}}
>
	<input type="hidden" name="id" value={waiting.id} />
	{#if repeated}<input type="hidden" name="igual" value="1" />{/if}
	{#if changing}
		<ExpenseFields
			bind:date
			bind:price
			bind:store
			bind:category
			onchanged={() => (repeated = null)}
		/>
	{:else}
		<p>
			<span class="font-medium">{store} · {euros(parseEuros(price) ?? 0)}</span>
			<span class="text-zinc-400">· {date === today ? 'hoy' : dayName(date)} · {category}</span>
		</p>
		<input type="hidden" name="date" value={date} />
		<input type="hidden" name="price" value={price} />
		<input type="hidden" name="store" value={store} />
		<input type="hidden" name="category" value={category} />
	{/if}
	{#if repeated}
		<div class="rounded-md border border-amber-500/40 bg-amber-950/40 p-2 text-xs" role="alert">
			<p class="text-amber-200">{sameText(repeated, today)} ¿Lo añado igual?</p>
			<a
				href="/gastos?mes={monthOf(repeated.date)}&gasto={repeated.id}"
				target="_blank"
				class="text-amber-400 hover:underline">Ver el otro</a
			>
		</div>
	{/if}
	{#if problem}<p class="text-xs text-red-400" role="alert">{problem}</p>{/if}
	<div class="flex flex-wrap gap-2">
		<button name="keep" value="true" class={primary} disabled={saving}
			>{saving ? 'Guardando…' : repeated ? 'Añadir igual' : 'Añadir a Dinero'}</button
		>
		{#if !changing}
			<button type="button" class={secondary} onclick={() => (changing = true)}>Cambiar</button>
		{/if}
		<button name="keep" value="false" formnovalidate class={secondary} disabled={saving}>No</button>
	</div>
</form>

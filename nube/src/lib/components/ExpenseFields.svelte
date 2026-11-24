<!--
@component
An expense's day, price, shop and category, to look over before it goes into Dinero: a wish bought
(#586), one a rule proposes (#600).
-->
<script lang="ts">
	import { EXPENSE_CATEGORIES } from 'comun/expenses.ts';
	import { field } from '#lib/styles.ts';

	interface Props {
		date: string;
		price: string;
		store: string;
		category: string;
		/** Another day or price: whether it is put in twice is asked again. */
		onchanged: () => void;
	}
	let {
		date = $bindable(),
		price = $bindable(),
		store = $bindable(),
		category = $bindable(),
		onchanged
	}: Props = $props();
</script>

<div class="flex gap-2">
	<label class="flex-1 text-xs text-zinc-400">
		Fecha
		<input
			type="date"
			name="date"
			required
			bind:value={date}
			oninput={onchanged}
			class="{field} mt-1 py-1 text-sm"
		/>
	</label>
	<label class="w-24 text-xs text-zinc-400">
		Precio (€)
		<input
			name="price"
			inputmode="decimal"
			bind:value={price}
			oninput={onchanged}
			placeholder="12,30"
			class="{field} mt-1 py-1 text-sm"
		/>
	</label>
</div>
<label class="text-xs text-zinc-400">
	Tienda
	<input name="store" maxlength="120" bind:value={store} class="{field} mt-1 py-1 text-sm" />
</label>
<label class="text-xs text-zinc-400">
	Categoría
	<select name="category" bind:value={category} class="{field} mt-1 py-1 text-sm">
		{#each EXPENSE_CATEGORIES as c (c)}<option>{c}</option>{/each}
	</select>
</label>

<!--
@component
«Marcar como comprado» on a wish (#586): a popover with the day and the price, ready to go into Dinero; or only
marked, when the receipt or the bank will bring the expense.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { monthOf } from 'comun/expenses.ts';
	import { sameText, type LooksSame } from 'comun/page-notices.ts';
	import ExpenseFields from '#lib/components/ExpenseFields.svelte';
	import { priceText } from '#lib/wishes.ts';
	import { primary, secondary } from '#lib/styles.ts';

	interface Props {
		wish: {
			id: number;
			title: string;
			shop: string;
			priceCents: number | null;
			currency: string | null;
			shippingCents: number | null;
		};
		today: string;
		/** Another adult's gift: they see Dinero too. */
		secret: boolean;
		onbought: (done: { expense: number | null; month: string }) => void;
	}
	let { wish, today, secret, onbought }: Props = $props();

	let popover = $state<HTMLElement>();
	let date = $state('');
	let price = $state('');
	let store = $state('');
	let category = $state('Otros');
	let saving = $state(false);
	let problem = $state<string | null>(null);
	let repeated = $state<LooksSame | null>(null);

	const otherCurrency = $derived(wish.currency && wish.currency !== 'EUR' ? wish.currency : null);

	/** As the wish has it, each time it opens. */
	function fill() {
		date = today;
		price =
			wish.priceCents !== null && !otherCurrency
				? ((wish.priceCents + (wish.shippingCents ?? 0)) / 100).toFixed(2).replace('.', ',')
				: '';
		store = wish.shop;
		category = 'Otros';
		problem = null;
		repeated = null;
	}
	/** Another day or price: whether it is put in twice is asked again. */
	const changed = () => (repeated = null);
</script>

<button
	type="button"
	class="text-zinc-400 hover:underline"
	popovertarget="comprado-{wish.id}"
	style:anchor-name="--comprado-{wish.id}">Marcar como comprado</button
>
<!-- Native popover, as Música's «Modo DJ»: closes with Esc or a click outside. -->
<div
	bind:this={popover}
	id="comprado-{wish.id}"
	popover="auto"
	role="dialog"
	aria-label="Marcar como comprado: {wish.title}"
	style:position-anchor="--comprado-{wish.id}"
	class="comprado inset-auto m-0 my-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-100 shadow-lg"
	onbeforetoggle={(e) => e.newState === 'open' && fill()}
>
	<form
		method="post"
		action="?/buy"
		class="flex flex-col gap-2"
		use:enhance={() => {
			saving = true;
			problem = null;
			const month = monthOf(date);
			return async ({ result, update }) => {
				saving = false;
				if (result.type === 'success') {
					popover?.hidePopover();
					onbought({ expense: Number(result.data?.expense) || null, month });
					await update({ reset: false });
				} else if (result.type === 'failure' && result.data?.repeated)
					repeated = result.data.repeated as LooksSame;
				else if (result.type === 'failure')
					problem = String(result.data?.message ?? 'No se pudo guardar');
				else problem = 'No se pudo guardar';
			};
		}}
	>
		<input type="hidden" name="id" value={wish.id} />
		{#if repeated}<input type="hidden" name="igual" value="1" />{/if}
		<ExpenseFields bind:date bind:price bind:store bind:category onchanged={changed} />
		{#if wish.shippingCents && wish.priceCents !== null && !otherCurrency}
			<p class="text-xs text-zinc-400">
				Con su envío, {priceText(wish.shippingCents, wish.currency)}: corrígelo si has pagado otro.
			</p>
		{/if}
		{#if otherCurrency}
			<p class="text-xs text-zinc-400">
				Su precio está en {otherCurrency}: escribe lo que has pagado en euros.
			</p>
		{/if}
		{#if secret}
			<p class="text-xs text-amber-200">
				Es un regalo: en Dinero la familia verá la tienda y el importe, no qué es.
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
		{#if problem}<p class="text-xs text-red-400" role="alert">{problem}</p>{/if}
		<button class={primary} disabled={saving}
			>{saving ? 'Guardando…' : repeated ? 'Guardar igual' : 'Añadir a Dinero'}</button
		>
		<button name="solo" value="1" class={secondary} disabled={saving}
			>Solo marcar como comprado</button
		>
	</form>
</div>

<style>
	.comprado {
		position-area: bottom span-right;
		position-try-fallbacks:
			flip-block,
			flip-inline,
			flip-block flip-inline;
	}
</style>

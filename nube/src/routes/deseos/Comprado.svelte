<!--
@component
«Marcar como comprado» on a wish (#586): a popover with the day and the price, ready to go into Dinero; or only
marked, when the receipt or the bank will bring the expense.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { enhance } from '$app/forms';
	import { monthOf, parseEuros } from 'comun/expenses.ts';
	import { sameText, type LooksSame } from 'comun/page-notices.ts';
	import ExpenseFields from '#lib/components/ExpenseFields.svelte';
	import { amountField, extraFromText, priceText } from '#lib/wishes.ts';
	import { field, primary, secondary } from '#lib/styles.ts';

	interface Props {
		wish: {
			id: number;
			title: string;
			shop: string;
			priceCents: number | null;
			currency: string | null;
			shippingCents: number | null;
			extraCents: number | null;
		};
		today: string;
		/** Another adult's gift: they see Dinero too. */
		secret: boolean;
		/** Its popover, open or closed. */
		onopen: (open: boolean) => void;
		onbought: (done: { expense: number | null; month: string }) => void;
	}
	let { wish, today, secret, onopen, onbought }: Props = $props();

	let popover = $state<HTMLElement>();
	let date = $state('');
	let price = $state('');
	/** «IVA y otros», as written, and what of `price` is it, in cents. */
	let extra = $state('');
	let extraCents = $state(0);
	let store = $state('');
	let category = $state('Otros');
	let saving = $state(false);
	let problem = $state<string | null>(null);
	let repeated = $state<LooksSame | null>(null);

	const otherCurrency = $derived(wish.currency && wish.currency !== 'EUR' ? wish.currency : null);

	/** Its price in euros is known: only then are its extras added to it. */
	const priced = $derived(wish.priceCents !== null && !otherCurrency);

	/** As the wish has it, each time it opens. */
	function fill() {
		date = today;
		price =
			wish.priceCents !== null && !otherCurrency
				? amountField(wish.priceCents + (wish.shippingCents ?? 0) + (wish.extraCents ?? 0))
				: '';
		extra = amountField(wish.extraCents);
		extraCents = wish.extraCents ?? 0;
		store = wish.shop;
		category = 'Otros';
		problem = null;
		repeated = null;
	}
	let open = false;
	function setOpen(now: boolean) {
		if (now === open) return;
		open = now;
		onopen(now);
	}
	// Its card gone while open: no toggle comes.
	onDestroy(() => setOpen(false));
	/** Another day or price: whether it is put in twice is asked again. */
	const changed = () => (repeated = null);
	/** Another «IVA y otros»: the price with it, in place of the one it had. */
	function setExtra() {
		const total = parseEuros(price);
		if (total === null) return;
		const base = total - extraCents;
		const read = extraFromText(extra, base);
		// Half written («4,»), or in another currency: none yet.
		const now = read && (read.currency ?? 'EUR') === 'EUR' ? read.cents : 0;
		extraCents = now;
		price = amountField(base + now);
		changed();
	}
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
	onbeforetoggle={(e) => {
		if (e.newState === 'open') fill();
		setOpen(e.newState === 'open');
	}}
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
		{#if priced}
			<input type="hidden" name="extra" value={extraCents} />
			<label class="text-xs text-zinc-400">
				IVA y otros que añade la tienda
				<input
					bind:value={extra}
					oninput={setExtra}
					maxlength="20"
					placeholder="1,34 o 4 %"
					class="{field} mt-1 py-1 text-sm"
				/>
			</label>
			{#if extraCents}
				<p class="text-xs text-zinc-400">
					En el precio de arriba, {priceText(extraCents, 'EUR')} de IVA y otros.
				</p>
			{/if}
		{/if}
		{#if wish.shippingCents && priced}
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

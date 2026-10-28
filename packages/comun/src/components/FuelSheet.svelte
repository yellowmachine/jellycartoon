<script lang="ts">
	import { page } from '$app/state';
	import { euros, parseEuros, type ExpenseDraft, type ExpenseLine } from 'comun/expenses.ts';
	import { smallerPhoto } from 'comun/receipt-photo.ts';
	import type { LngLat } from 'comun/road.ts';

	/**
	 * Fuel, from the road mode (#194): stopped at the petrol station, what was paid, big for a
	 * thumb, or the receipt's photo read here without leaving the road mode. Saved in Gastos, today,
	 * as «Gasolina»: typed, named after where we are (GPS); read, as the receipt says. Each app says
	 * where it reads and saves (`urls`): at home, through its server to the cloud; in the cloud, there.
	 */
	let {
		position,
		onclose,
		urls = { read: '/api/gastos/leer', save: '/api/gastos/gasolina' }
	}: {
		position: LngLat | null;
		onclose: () => void;
		urls?: { read: string; save: string };
	} = $props();

	/** As written in the box, «50,30». */
	let amount = $state('');
	/** A receipt read: its name and lines, and its photo waiting to be kept with it. */
	let read = $state<{ store: string; lines: ExpenseLine[]; receipt: string } | null>(null);
	let reading = $state(false);
	let saving = $state(false);
	let problem = $state<string | null>(null);
	let saved = $state<string | null>(null);

	async function readPhoto(file: File | undefined) {
		if (!file) return;
		problem = null;
		reading = true;
		const form = new FormData();
		form.set('foto', await smallerPhoto(file), 'ticket.jpg');
		const res = await fetch(urls.read, { method: 'POST', body: form }).catch(() => null);
		const body = await res?.json().catch(() => null);
		reading = false;
		if (!res?.ok) return void (problem = body?.message ?? 'Sin conexión');
		const draft = body as ExpenseDraft;
		read = { store: draft.store, lines: draft.lines, receipt: draft.receipt };
		if (draft.total) amount = (draft.total / 100).toFixed(2).replace('.', ',');
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const total = parseEuros(amount);
		if (!total || total <= 0) return void (problem = 'Escribe cuánto, en euros: 50,30');
		problem = null;
		saving = true;
		const res = await fetch(urls.save, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				total,
				position,
				store: read?.store ?? null,
				lines: read?.lines ?? [],
				receipt: read?.receipt ?? null
			})
		}).catch(() => null);
		const body = await res?.json().catch(() => null);
		saving = false;
		if (!res?.ok) return void (problem = body?.message ?? 'Sin conexión');
		saved = `${body.store}, ${euros(body.total)}`;
		setTimeout(onclose, 2500);
	}

	const button =
		'flex items-center justify-center rounded-2xl px-6 py-4 text-2xl font-semibold active:scale-95 disabled:opacity-40';
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95 p-4"
	role="dialog"
	aria-modal="true"
	aria-label="Gasolina"
>
	<div class="flex w-full max-w-md flex-col gap-5 text-center">
		<h2 class="text-3xl font-bold">⛽ Gasolina</h2>
		{#if saved}
			<p class="text-2xl text-emerald-400" aria-live="polite">Apuntado en Gastos: {saved}</p>
		{:else}
			<form onsubmit={save} class="flex flex-col gap-5">
				{#if read}
					<p class="text-lg text-zinc-300">Leído del ticket: {read.store}</p>
				{/if}
				<label class="flex flex-col gap-2 text-xl text-zinc-300">
					Cuánto
					<span class="flex items-center justify-center gap-2">
						<input
							bind:value={amount}
							inputmode="decimal"
							{@attach (el) => el.focus()}
							placeholder="0,00"
							aria-label="Importe en euros"
							class="w-48 rounded-2xl border-zinc-700 bg-zinc-900 py-3 text-center text-4xl font-bold tabular-nums focus:border-amber-500 focus:ring-amber-500"
						/>
						<span class="text-4xl font-bold">€</span>
					</span>
				</label>
				{#if problem}
					<p class="text-lg text-amber-300" role="alert">{problem}</p>
				{/if}
				<button
					class="{button} bg-amber-500 text-zinc-950"
					disabled={saving || reading || !amount.trim()}>{saving ? 'Guardando…' : 'Guardar'}</button
				>
				{#if page.data.receipts && !read}
					<label class={[button, 'cursor-pointer bg-zinc-800', reading && 'opacity-60']}>
						{reading ? 'Leyendo el ticket…' : '📷 Ticket'}
						<input
							type="file"
							accept="image/*"
							capture="environment"
							class="hidden"
							disabled={reading}
							onchange={(e) => {
								const file = e.currentTarget.files?.[0];
								e.currentTarget.value = '';
								void readPhoto(file);
							}}
						/>
					</label>
				{/if}
				<button type="button" class="{button} bg-zinc-900 text-zinc-300" onclick={onclose}
					>Cancelar</button
				>
			</form>
		{/if}
	</div>
</div>

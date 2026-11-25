<script lang="ts">
	import { enhance } from '$app/forms';
	import { NOTICE_DAYS } from '#lib/charges.ts';
	import { section, select } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/** The notice of the fixed expenses about to be paid: theirs, unless a fixed one says otherwise. */
	let { data, tab }: { data: PageData; tab: string } = $props();

	const submit = (e: Event & { currentTarget: HTMLInputElement | HTMLSelectElement }) =>
		e.currentTarget.form?.requestSubmit();
</script>

{#snippet days(name: string, value: number)}
	<select {name} {value} class={select} onchange={submit}>
		<option value={0}>No avisar</option>
		{#each NOTICE_DAYS as n (n)}
			<option value={n}>{n === 1 ? 'El día antes' : `${n} días antes`}</option>
		{/each}
	</select>
{/snippet}

<section class={section} id="cargos">
	<h2 class="mb-1 font-semibold">Cargos que vienen</h2>
	<form
		method="post"
		action="?seccion={tab}&/saveChargeNotices"
		class="flex flex-col gap-3 text-sm"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
	>
		<label class="flex items-start gap-2">
			<input
				type="checkbox"
				name="on"
				checked={data.chargeNotices.on}
				onchange={submit}
				class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
			/>
			<span>
				Avisarme antes de los gastos fijos
				<span class="block text-xs text-zinc-500"
					>En la portada y en Dinero, para que haya saldo en la cuenta: Seilide no lo mira. Solo los
					que pusiste tú, o los que digan «Avisar a los demás adultos». Cada fijo puede tener sus
					días, en <a href="/gastos" class="text-amber-400 hover:underline">Dinero → Fijos</a
					>.</span
				>
			</span>
		</label>
		{#if data.chargeNotices.on}
			<label class="ml-6 flex flex-wrap items-center gap-2">
				Los de cada mes
				{@render days('monthly', data.chargeNotices.monthly)}
			</label>
			<label class="ml-6 flex flex-wrap items-center gap-2">
				Los demás (de cada varios meses o de cada año)
				{@render days('yearly', data.chargeNotices.yearly)}
			</label>
		{/if}
	</form>
</section>

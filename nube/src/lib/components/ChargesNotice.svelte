<!--
@component
«Cargos que vienen»: the fixed expenses about to be paid, in one box on the home page and in Dinero;
several, added up by account. Each one's «✕» closes that charge, until its next time.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { euros } from 'comun/expenses.ts';
	import { chargesSummary, chargeText, inDays, type Charge } from '#lib/charges.ts';

	let { charges }: { charges: Charge[] } = $props();

	let problem = $state(false);
</script>

{#snippet close(list: Charge[], label: string, text: string)}
	<!-- Not update(): from the home page it would go to Dinero (Kit 3). -->
	<form
		method="post"
		action="/gastos?/closeCharges"
		class="shrink-0"
		use:enhance={() =>
			async ({ result }) => {
				problem = result.type !== 'success';
				if (!problem) await refreshAll();
			}}
	>
		{#each list as c (c.id)}<input type="hidden" name="cargo" value="{c.id}:{c.day}" />{/each}
		<button
			class="rounded-md px-2 py-1 text-amber-200 hover:bg-amber-500/20"
			aria-label={label}
			title={label}>{text}</button
		>
	</form>
{/snippet}

{#if charges.length}
	<section
		class="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
		aria-label="Cargos que vienen"
	>
		{#if charges.length === 1}
			<div class="flex items-start gap-2">
				<p class="min-w-0 flex-1 py-1">{chargeText(charges[0]!)}</p>
				{@render close(charges, 'Cerrar este aviso', '✕')}
			</div>
		{:else}
			<details>
				<summary class="cursor-pointer py-1">{chargesSummary(charges)}</summary>
				<ul class="mt-2 divide-y divide-amber-500/20">
					{#each charges as c (c.id)}
						<li class="flex items-center gap-2 py-1">
							<span class="min-w-0 flex-1">
								{inDays(c.left)}, {c.name}
								{#if c.account}<span class="text-zinc-400"> · {c.account}</span>{/if}
							</span>
							<span class="shrink-0 tabular-nums">{euros(c.amount)}</span>
							{@render close([c], `Cerrar el aviso de ${c.name}`, '✕')}
						</li>
					{/each}
				</ul>
				<div class="mt-2 flex justify-end">
					{@render close(charges, 'Cerrar todos estos avisos', 'Cerrar todos')}
				</div>
			</details>
		{/if}
		{#if problem}<p class="mt-1 text-red-300" role="alert">No se pudo cerrar</p>{/if}
	</section>
{/if}

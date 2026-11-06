<script lang="ts">
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import { secondary, section } from '#lib/styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * The family's administration, to another of its adults (#315). What was done stays said after it
	 * goes: who gave it no longer sees the rest.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const problem = $derived(form && 'handOverProblem' in form ? form.handOverProblem : null);
	// typeof: requireAdmin's failure (+page.server.ts) has any key, as a string.
	const done = $derived(
		form && 'handedOver' in form && typeof form.handedOver === 'object' ? form.handedOver : null
	);
</script>

{#if data.handOver || done}
	<section class={section} id="administracion">
		<h2 class="mb-1 font-semibold">Administración</h2>
		{#if done}
			<p class="text-sm {done.sent ? 'text-zinc-300' : 'text-amber-400'}">
				{done.sent
					? `${done.name} administra ahora la familia. Se lo hemos dicho por correo.`
					: `${done.name} administra ahora la familia, pero el correo no salió: díselo tú.`}
			</p>
		{/if}
		{#if data.handOver}
			<p class="mb-4 text-sm text-zinc-400">
				Puedes pasársela a otro adulto de la familia. Es inmediato: dejas de administrar, y solo
				quien administre podrá devolvértela.
			</p>
			{#if data.handOver.others.length}
				<ul class="divide-y divide-zinc-800">
					{#each data.handOver.others as a (a.id)}
						<li class="flex flex-wrap items-center justify-between gap-3 py-2">
							<span class="min-w-0 truncate">{a.name}</span>
							<ConfirmForm
								action="?seccion={tab}&/handOverAdmin"
								fields={{ to: a.id }}
								label="Pasarle la administración"
								question="¿Pasarle la administración a {a.name}? Dejarás de administrar la familia."
								yes="Sí, pasársela"
								class={secondary}
							/>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-zinc-500">
					No hay otro adulto al que pasársela. Invítalo primero, aquí arriba.
				</p>
			{/if}
			{#if data.handOver.admins.length > 1}
				<div class="mt-4">
					<ConfirmForm
						action="?seccion={tab}&/stepDownAdmin"
						label="Dejar de administrar"
						question="¿Dejar de administrar? La familia sigue con quien también la administra."
						yes="Sí, dejarlo"
						class={secondary}
					/>
				</div>
			{/if}
			{#if problem}
				<p class="mt-3 text-sm text-red-400">{problem}</p>
			{/if}
		{/if}
	</section>
{/if}

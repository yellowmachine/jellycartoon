<script lang="ts">
	import { enhance } from '$app/forms';
	import PreguntarTabs from '#lib/components/PreguntarTabs.svelte';
	import ReportView from '#lib/components/report/ReportView.svelte';
	import { daysText } from '#lib/report-days.ts';
	import { isSummaryReport } from '#lib/reports.ts';
	import type { PageProps } from './$types';

	/**
	 * A report (#505): kept as it was made; «Actualizar» takes its figures again (the words stay, as
	 * the expenses taken away).
	 */
	let { data, form }: PageProps = $props();
	const r = $derived(data.report);
	/** A Resumen kept (#624): as it was, never taken again. */
	const frozen = $derived(isSummaryReport(r));

	let refreshing = $state(false);
	let renaming = $state(false);
	let confirmDelete = $state(false);

	const when = new Intl.DateTimeFormat('es-ES', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
	const refreshed = $derived(
		new Date(r.refreshedAt).getTime() - new Date(r.createdAt).getTime() > 60_000
	);
</script>

<svelte:head>
	<title>{r.title} · Informes · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="mb-3 text-2xl font-bold">Preguntar</h1>
	<PreguntarTabs />
	<a href="/preguntar/informes" class="text-sm text-zinc-400 hover:text-white">← Informes</a>

	<header class="mt-2 mb-4">
		{#if renaming}
			<form
				method="post"
				action="?/renombrar"
				class="flex gap-2"
				use:enhance={() =>
					async ({ update }) => {
						await update({ reset: false });
						renaming = false;
					}}
			>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					name="title"
					value={r.title}
					maxlength="100"
					autofocus
					aria-label="Nombre del informe"
					class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xl font-semibold"
				/>
				<button class="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950"
					>Guardar</button
				>
				<button type="button" class="text-sm text-zinc-400" onclick={() => (renaming = false)}
					>Cancelar</button
				>
			</form>
		{:else}
			<h2 class="text-xl font-semibold text-zinc-100">
				{r.title}
				<button
					class="ml-1 align-middle text-sm font-normal text-zinc-500 hover:text-white"
					onclick={() => (renaming = true)}>Cambiar nombre</button
				>
			</h2>
		{/if}
		<p class="text-sm text-zinc-400 first-letter:uppercase">{daysText(r.from, r.to)}</p>
		<p class="mt-1 text-xs text-zinc-500">
			{#if frozen}
				Resumen guardado el {when.format(new Date(r.createdAt))}, tal como estaba: no cambia.
			{:else if refreshed}
				Hecho el {when.format(new Date(r.createdAt))}; cifras al día del {when.format(
					new Date(r.refreshedAt)
				)}. El texto es el de cuando se hizo.
			{:else}
				Hecho el {when.format(new Date(r.createdAt))}, con los datos de ese momento.
			{/if}
		</p>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			{#if !frozen}<form
					method="post"
					action="?/actualizar"
					use:enhance={() => {
						refreshing = true;
						return async ({ update }) => {
							await update();
							refreshing = false;
						};
					}}
				>
					<button
						disabled={refreshing}
						class="rounded-md border border-zinc-700 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
						>{refreshing ? 'Actualizando…' : 'Actualizar'}</button
					>
				</form>{/if}
			{#if confirmDelete}
				<form method="post" action="?/borrar" use:enhance class="flex items-center gap-2">
					<span class="text-sm text-zinc-400">¿Borrar este informe?</span>
					<button class="rounded-md bg-red-600 px-3 py-1 text-sm text-claro hover:bg-red-500"
						>Borrar</button
					>
					<button
						type="button"
						class="rounded-md px-3 py-1 text-sm text-zinc-400 hover:bg-zinc-800"
						onclick={() => (confirmDelete = false)}>No</button
					>
				</form>
			{:else}
				<button
					class="rounded-md px-3 py-1 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-white"
					onclick={() => (confirmDelete = true)}>Borrar</button
				>
			{/if}
		</div>
		{#if form?.message}<p class="mt-2 text-sm text-red-400">{form.message}</p>{/if}
	</header>

	<ReportView report={r} />
</div>

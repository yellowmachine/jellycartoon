<script lang="ts">
	import { enhance } from '$app/forms';
	import { primary } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	/** Linking two families (#464): accepted here by an adult of the other one. */
	let { data, form }: PageProps = $props();

	const link = $derived(data.link);
	let busy = $state(false);
</script>

<svelte:head>
	<title>Vincular familias · Seilide</title>
</svelte:head>

<div class="mx-auto mt-12 max-w-md">
	<h1 class="mb-6 text-2xl font-bold">Vincular familias</h1>

	{#if link.kind === 'none'}
		<p class="text-zinc-300">
			Este enlace no es de ningún vínculo: puede que ya se usara o que lo quitaran. Pide que te
			manden otro.
		</p>
	{:else if link.kind === 'blocked'}
		{#if link.familyName}
			<p class="mb-2 text-zinc-400">De la familia <strong>{link.familyName}</strong>.</p>
		{/if}
		<p class="text-amber-400">{link.problem}.</p>
	{:else}
		<p class="mb-4 text-lg">
			{link.inviterName ?? 'Alguien'}, de la familia <strong>{link.familyName}</strong>, quiere
			vincularla con la tuya.
		</p>
		<ul class="mb-6 list-disc space-y-1 pl-5 text-sm text-zinc-300">
			<li>Los mayores de las dos familias os veréis en Llamadas y podréis llamaros.</li>
			<li>Nada más se comparte: ni la agenda, ni la nevera, ni los gastos. Los peques no salen.</li>
			<li>Cualquiera de las dos familias lo quita cuando quiera, en Ajustes → Familia.</li>
		</ul>
		<form
			method="post"
			action="?/accept"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
				};
			}}
		>
			<button class={primary} disabled={busy}>{busy ? 'Vinculando…' : 'Vincular'}</button>
		</form>
		{#if form?.problem}
			<p class="mt-3 text-sm text-red-400">{form.problem}.</p>
		{/if}
	{/if}
</div>

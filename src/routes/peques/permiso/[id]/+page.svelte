<script lang="ts">
	import { avatar, type PermitId } from 'comun/avatars.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Answered here: what was said, or why not. */
	let done = $state<string | null>(null);
	let problem = $state<string | null>(null);
	let busy = $state(false);

	async function answer(value: PermitId | 'no') {
		if (!data.request) return;
		busy = true;
		problem = null;
		const res = await fetch(`/api/peques/peticiones/${data.request.id}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ answer: value })
		}).catch(() => null);
		busy = false;
		if (!res?.ok) problem = 'No se pudo contestar. Prueba otra vez.';
		else if ((await res.json()).result === 'late')
			problem = 'Ya había contestado otro adulto, o pasó el tiempo.';
		else done = value === 'no' ? 'Le has dicho que no.' : `¡Hecho! ${data.request.name} ya entra.`;
	}
</script>

<svelte:head>
	<title>Dejar entrar · JellyCartoon</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col items-center gap-6 pt-10 text-center">
	{#if done}
		<p class="text-2xl font-semibold">{done}</p>
		<a href="/" class="text-amber-400 hover:underline">Volver a JellyCartoon</a>
	{:else if data.request}
		{@const a = avatar(data.request.avatar)}
		<span
			class="flex h-28 w-28 items-center justify-center rounded-full text-6xl shadow-xl {a.color}"
			>{a.emoji}</span
		>
		<p class="text-xl">
			<span class="font-semibold">{data.request.name}</span> quiere entrar en {data.request.device}.
		</p>
		<div class="flex flex-wrap justify-center gap-2">
			{#each data.permits as permit (permit.id)}
				<button
					class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
					disabled={busy}
					onclick={() => answer(permit.id)}>{permit.label}</button
				>
			{/each}
			<button
				class="rounded-md border border-zinc-700 px-4 py-2 hover:bg-zinc-900 disabled:opacity-50"
				disabled={busy}
				onclick={() => answer('no')}>No</button
			>
		</div>
		{#if problem}<p class="text-sm text-red-400">{problem}</p>{/if}
	{:else}
		<p class="text-xl">Esa petición ya no está.</p>
		<p class="text-sm text-zinc-400">
			Ya la contestó alguien, pasaron los dos minutos o no es de uno de tus peques. Que vuelva a
			elegir su dibujo.
		</p>
		<a href="/" class="text-amber-400 hover:underline">Volver a JellyCartoon</a>
	{/if}
</div>

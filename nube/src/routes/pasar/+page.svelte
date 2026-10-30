<script lang="ts">
	import { enhance } from '$app/forms';
	import { avatar } from 'comun/avatars.ts';
	import { primary, section } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let chosen = $state<string | null>(null);
</script>

<svelte:head>
	<title>Pasar a un peque · Seilide</title>
</svelte:head>

<h1 class="mb-2 text-2xl font-bold">Pasar a un peque</h1>
<p class="mb-6 text-sm text-zinc-400">
	Tu móvil se queda como el suyo un rato: solo verá su agenda, la nevera, y las series y la música
	de peques. Para volver a lo tuyo, entra otra vez con tu contraseña.
</p>

<form method="post" use:enhance class="{section} flex flex-col gap-6">
	<div class="flex flex-wrap gap-6">
		{#each data.kids as kid (kid.id)}
			{@const a = avatar(kid.avatar)}
			<label class="flex cursor-pointer flex-col items-center gap-2">
				<input type="radio" name="kidId" value={kid.id} bind:group={chosen} class="sr-only" />
				<span
					class={[
						'flex h-20 w-20 items-center justify-center rounded-full text-5xl transition',
						a.color,
						chosen === kid.id ? 'ring-4 ring-amber-400' : 'opacity-70'
					]}>{a.emoji}</span
				>
				<span class="font-semibold">{kid.name}</span>
			</label>
		{/each}
	</div>
	<fieldset class="flex flex-wrap gap-3">
		<legend class="mb-2 text-sm text-zinc-300">¿Cuánto rato?</legend>
		{#each data.permits as permit, i (permit.id)}
			<label class="flex items-center gap-2 text-sm">
				<input type="radio" name="permit" value={permit.id} checked={i === 0} />
				{permit.label}
			</label>
		{/each}
	</fieldset>
	<button class="{primary} self-start" disabled={!chosen}>Pasárselo</button>
	{#if form?.message}
		<p class="text-sm text-red-400">{form.message}</p>
	{/if}
</form>

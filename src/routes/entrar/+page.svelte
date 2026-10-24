<script lang="ts">
	import { enhance } from '$app/forms';
	import { avatar } from '#lib/avatars.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const drawing = $derived(data.state === 'ask' && data.avatar ? avatar(data.avatar) : null);
	const initial = $derived(
		data.state === 'ask' ? ([...data.name.trim()][0]?.toLocaleUpperCase('es') ?? '?') : '?'
	);
	const primary =
		'w-full rounded-md bg-amber-500 py-2 font-medium text-zinc-950 hover:bg-amber-400';
	const secondary = 'w-full rounded-md border border-zinc-700 py-2 hover:bg-zinc-900';
</script>

<svelte:head>
	<title>Entrar en la tele · JellyCartoon</title>
</svelte:head>

<div class="mx-auto mt-16 max-w-sm text-center">
	{#if form && 'done' in form}
		<p class="text-2xl font-semibold text-amber-400">
			{form.done === 'approved' ? '✓ Ya estás dentro' : 'De acuerdo: no entra'}
		</p>
		<p class="mt-2 text-zinc-400">
			{form.done === 'approved' ? 'Mira la pantalla: entra con tu cuenta.' : 'Puedes cerrar esto.'}
		</p>
	{:else if data.state === 'ask'}
		<span
			class={[
				'mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full',
				drawing ? `text-5xl ${drawing.color}` : 'bg-amber-500 text-4xl font-semibold text-zinc-950'
			]}
			aria-hidden="true">{drawing ? drawing.emoji : initial}</span
		>
		<h1 class="text-2xl font-bold">¿Entrar en {data.device}?</h1>
		<p class="mt-2 mb-8 text-zinc-400">
			Con tu cuenta, {data.name}. Di que sí solo si estás delante de {data.device}.
		</p>
		<form method="post" use:enhance class="space-y-3">
			<button name="answer" value="yes" class={primary}>Entrar</button>
			<button name="answer" value="no" class={secondary}>No</button>
		</form>
		{#if form?.message}
			<p class="mt-4 text-sm text-red-400">{form.message}</p>
		{/if}
	{:else if data.state === 'not-yours'}
		<h1 class="text-2xl font-bold">Este código es para {data.name}</h1>
		<p class="mt-2 text-zinc-400">
			Para entrar tú, elige tu dibujo en la pantalla y lee el código que te salga.
		</p>
	{:else}
		<h1 class="text-2xl font-bold">Este código ya no vale</h1>
		<p class="mt-2 text-zinc-400">Caducó o ya se usó. Elige tu dibujo otra vez en la pantalla.</p>
	{/if}
</div>

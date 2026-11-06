<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordInput from 'comun/components/PasswordInput.svelte';
	import { field } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Elegir contraseña · Seilide</title>
</svelte:head>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="mb-6 text-2xl font-bold">Elige otra contraseña</h1>
	{#if form?.expired || !data.token}
		<p class="text-zinc-300">Este enlace ya no vale: caduca en una hora y solo sirve una vez.</p>
		<p class="mt-4 text-center text-sm">
			<a href="/login/olvidada" class="text-amber-400 hover:underline">Pedir otro enlace</a>
		</p>
	{:else}
		<form method="post" use:enhance class="space-y-4">
			<input type="hidden" name="token" value={data.token} />
			<label class="block text-sm">
				Contraseña nueva, de 10 caracteres por lo menos
				<PasswordInput
					name="password"
					required
					minlength={10}
					box="mt-1"
					class={field}
					autocomplete="new-password"
				/>
			</label>
			{#if form?.message}
				<p class="text-sm text-red-400">{form.message}</p>
			{/if}
			<button
				class="w-full rounded-md bg-amber-500 py-2 font-medium text-zinc-950 hover:bg-amber-400"
				>Guardar</button
			>
			<p class="text-sm text-zinc-400">Se cerrará tu sesión en todos los aparatos.</p>
		</form>
	{/if}
</div>

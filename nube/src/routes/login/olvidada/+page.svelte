<script lang="ts">
	import { enhance } from '$app/forms';
	import { field } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head>
	<title>He olvidado mi contraseña · Seilide</title>
</svelte:head>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="mb-6 text-2xl font-bold">He olvidado mi contraseña</h1>
	{#if form?.sent}
		<p role="status" class="text-zinc-300">
			Si ese email tiene cuenta, te hemos mandado un enlace para elegir otra. Caduca en una hora.
			Mira también en el correo no deseado.
		</p>
	{:else}
		<form method="post" use:enhance class="space-y-4">
			<label class="block text-sm">
				Tu email
				<input type="email" name="email" required autocomplete="email" class="mt-1 {field}" />
			</label>
			<button
				class="w-full rounded-md bg-amber-500 py-2 font-medium text-zinc-950 hover:bg-amber-400"
				>Mandarme el enlace</button
			>
		</form>
	{/if}
	<p class="mt-4 text-center text-sm">
		<a href="/login?adulto" class="text-amber-400 hover:underline">Volver a entrar</a>
	</p>
</div>

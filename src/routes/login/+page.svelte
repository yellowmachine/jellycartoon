<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let mode = $state<'signIn' | 'signUp'>('signIn');

	const input =
		'mt-1 block w-full rounded-md border-zinc-700 bg-zinc-900 text-zinc-100 focus:border-amber-400 focus:ring-amber-400';
</script>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="mb-8 text-center text-3xl font-bold text-amber-400">JellyCartoon</h1>
	<form method="post" action="?/{mode}" use:enhance class="space-y-4">
		{#if mode === 'signUp'}
			<label class="block text-sm">
				Nombre
				<input name="name" class={input} autocomplete="name" />
			</label>
		{/if}
		<label class="block text-sm">
			Email
			<input type="email" name="email" required class={input} autocomplete="email" />
		</label>
		<label class="block text-sm">
			Contraseña
			<input
				type="password"
				name="password"
				required
				minlength="8"
				class={input}
				autocomplete={mode === 'signIn' ? 'current-password' : 'new-password'}
			/>
		</label>
		{#if form?.message}
			<p class="text-sm text-red-400">{form.message}</p>
		{/if}
		<button
			class="w-full rounded-md bg-amber-500 py-2 font-medium text-zinc-950 hover:bg-amber-400"
		>
			{mode === 'signIn' ? 'Entrar' : 'Crear cuenta'}
		</button>
	</form>
	{#if data.allowSignup}
		<button
			class="mt-4 w-full text-center text-sm text-zinc-400 hover:text-white"
			onclick={() => (mode = mode === 'signIn' ? 'signUp' : 'signIn')}
		>
			{mode === 'signIn' ? '¿No tienes cuenta? Regístrate' : 'Ya tengo cuenta'}
		</button>
	{/if}
</div>

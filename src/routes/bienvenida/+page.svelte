<script lang="ts">
	import { enhance } from '$app/forms';
	import favicon from '#lib/assets/favicon.svg';
	import PasswordInput from '#lib/components/PasswordInput.svelte';
	import { avatar } from '#lib/avatars.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const field =
		'block w-full rounded-md border-zinc-700 bg-zinc-900 text-zinc-100 focus:border-amber-400 focus:ring-amber-400';
	const primary =
		'block w-full rounded-md bg-amber-500 py-2 text-center font-medium text-zinc-950 hover:bg-amber-400';
	/** Their drawing, or their initial on the app's colour, as on the bar's round badge. */
	const drawing = $derived(data.state === 'valid' && data.avatar ? avatar(data.avatar) : null);
	const initial = $derived(
		data.state === 'valid' ? ([...data.name.trim()][0]?.toLocaleUpperCase('es') ?? '?') : '?'
	);
</script>

<svelte:head>
	<title>Bienvenida · JellyCartoon</title>
</svelte:head>

<div class="mx-auto mt-16 max-w-sm">
	{#if data.state === 'valid'}
		<span
			class={[
				'mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full',
				drawing ? `text-5xl ${drawing.color}` : 'bg-amber-500 text-4xl font-semibold text-zinc-950'
			]}
			aria-hidden="true">{drawing ? drawing.emoji : initial}</span
		>
		<h1 class="text-center text-3xl font-bold text-amber-400">Hola, {data.name}</h1>
		<p class="mt-2 mb-8 text-center text-zinc-400">Elige tu contraseña para JellyCartoon.</p>
		{#if data.signedInAs}
			<p class="mb-4 rounded-md border border-zinc-700 p-3 text-sm text-zinc-300">
				En este dispositivo está dentro {data.signedInAs}: al elegirla, entrarás tú.
			</p>
		{/if}
		<form method="post" use:enhance class="space-y-4">
			<!-- The email, for the phone's password manager to save it with the password. -->
			<input type="email" value={data.email} autocomplete="username" readonly hidden />
			<label class="block text-sm">
				Contraseña
				<!-- svelte-ignore a11y_autofocus -->
				<PasswordInput
					name="password"
					required
					minlength={8}
					autocomplete="new-password"
					autofocus
					box="mt-1"
					class={field}
				/>
			</label>
			<p class="text-xs text-zinc-500">
				De 8 caracteres o más. Tu móvil puede proponerte una y guardarla.
			</p>
			{#if form?.message}
				<p class="text-sm text-red-400">{form.message}</p>
			{/if}
			<button class={primary}>Entrar</button>
		</form>
	{:else}
		<img src={favicon} alt="" class="mx-auto mb-4 h-20 w-20 rounded-2xl" />
		<h1 class="mb-4 text-center text-2xl font-bold text-amber-400">
			{data.state === 'used' ? 'Este enlace ya se usó' : 'Este enlace ya no vale'}
		</h1>
		<p class="mb-8 text-center text-zinc-400">
			{data.state === 'used'
				? 'Ya elegiste tu contraseña: entra con ella.'
				: 'Caducó o hay uno más nuevo. Pide otro a quien administra la app.'}
		</p>
		<a href="/login" class={primary}>Ir a entrar</a>
	{/if}
</div>

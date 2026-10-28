<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import PasswordInput from 'comun/components/PasswordInput.svelte';
	import { field } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	/** «Tengo una invitación»: the account is made with the invited email. */
	let mode = $state<'signIn' | 'signUp'>('signIn');
	$effect(() => {
		if (form && 'signUp' in form) mode = 'signUp';
	});
	/** The second step with a recovery code, instead of the app's. */
	let recovery = $state(false);
	$effect(() => {
		if (form && 'recovery' in form) recovery = Boolean(form.recovery);
	});
	const twoFactor = $derived(Boolean(form && 'twoFactor' in form && form.twoFactor));

	/** An action keeping where to go after (`?next=`), which «?/action» alone would drop. */
	const action = (name: string) => {
		const next = page.url.searchParams.get('next');
		return `?${next ? `next=${encodeURIComponent(next)}&` : ''}/${name}`;
	};

	const input = `mt-1 ${field}`;
	const primary =
		'w-full rounded-md bg-amber-500 py-2 font-medium text-zinc-950 hover:bg-amber-400';
</script>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="text-center text-3xl font-bold text-amber-400">Nube</h1>
	<p class="mt-2 mb-8 text-center text-zinc-400">Las cosas de casa, también fuera.</p>
	{#if twoFactor}
		<!-- The second step: the code from the app (Proton Pass, Google Authenticator…). -->
		<form method="post" action={action('verify')} use:enhance class="space-y-4">
			<label class="block text-sm">
				{recovery ? 'Código de recuperación' : 'Código de tu app de verificación'}
				{#if recovery}
					<input
						name="code"
						required
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						class="{input} font-mono"
					/>
				{:else}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						name="code"
						required
						inputmode="numeric"
						pattern="[0-9 ]*"
						maxlength={7}
						autocomplete="one-time-code"
						autofocus
						class="{input} font-mono text-lg tracking-widest"
					/>
				{/if}
			</label>
			<input type="hidden" name="recovery" value={recovery ? 'on' : ''} />
			<label class="flex items-center gap-2 text-sm text-zinc-300">
				<input
					type="checkbox"
					name="trust"
					checked
					class="rounded border-zinc-600 bg-zinc-900 text-amber-500"
				/>
				Recordar este dispositivo 90 días
			</label>
			{#if form?.message}
				<p class="text-sm text-red-400">{form.message}</p>
			{/if}
			<button class={primary}>Entrar</button>
		</form>
		<button
			class="mt-4 w-full text-center text-sm text-zinc-400 hover:text-white"
			onclick={() => (recovery = !recovery)}
		>
			{recovery ? 'Usar el código de la app' : '¿Sin el móvil? Usa un código de recuperación'}
		</button>
	{:else}
		<form method="post" action={action(mode)} use:enhance class="space-y-4">
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
				<PasswordInput
					name="password"
					required
					minlength={10}
					box="mt-1"
					class={field}
					autocomplete={mode === 'signIn' ? 'current-password' : 'new-password'}
				/>
			</label>
			{#if form?.message}
				<p class="text-sm text-red-400">{form.message}</p>
			{/if}
			<button class={primary}>
				{mode === 'signIn' ? 'Entrar' : 'Crear la cuenta'}
			</button>
		</form>
		<button
			class="mt-4 w-full text-center text-sm text-zinc-400 hover:text-white"
			onclick={() => (mode = mode === 'signIn' ? 'signUp' : 'signIn')}
		>
			{mode === 'signIn' ? 'Tengo una invitación: crear mi cuenta' : 'Ya tengo cuenta: entrar'}
		</button>
	{/if}
</div>

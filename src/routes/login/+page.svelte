<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import PasswordInput from 'comun/components/PasswordInput.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	/** A new install only creates its administrator's account; the rest, they do in Ajustes (#157). */
	const mode = $derived(data.firstAccount ? 'signUp' : 'signIn');
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

	const field =
		'block w-full rounded-md border-zinc-700 bg-zinc-900 text-zinc-100 focus:border-amber-400 focus:ring-amber-400';
	const input = `mt-1 ${field}`;
	const primary =
		'w-full rounded-md bg-amber-500 py-2 font-medium text-zinc-950 hover:bg-amber-400';
</script>

<div class="mx-auto mt-16 max-w-sm">
	<img src={favicon} alt="" class="mx-auto mb-4 h-20 w-20 rounded-2xl" />
	<h1 class="text-center text-3xl font-bold text-amber-400">JellyCartoon</h1>
	<p class="mt-2 mb-8 text-center text-zinc-400">Tus series y películas, en casa.</p>
	{#if data.firstAccount}
		<h2 class="mb-1 font-semibold">Crear la cuenta de administrador</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Es la primera de esta instalación: con ella crearás en Ajustes las de las demás personas de la
			casa.
		</p>
	{:else if data.passwordChanged && !twoFactor}
		<p
			class="mb-4 rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-300"
		>
			✓ Contraseña cambiada: entra con ella y el código de tu app.
		</p>
	{/if}
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
					minlength={8}
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
		{#if mode === 'signIn' && data.nube}
			<!-- Not enhanced: the action answers with a redirect to the cloud, another site (#279). -->
			<form method="post" action={action('nube')} class="mt-4">
				<button
					class="w-full rounded-md border border-zinc-700 py-2 font-medium text-zinc-100 hover:border-amber-400"
				>
					Entrar con Seilide
				</button>
			</form>
			{#if data.nubeProblem}
				<p class="mt-2 text-sm text-red-400">{data.nubeProblem}</p>
			{/if}
		{/if}
		{#if mode === 'signIn'}
			<p class="mt-4 text-center text-sm text-zinc-500">
				¿Sin cuenta, o sin tu contraseña? Pide un enlace a quien administra la app.
			</p>
		{/if}
	{/if}
</div>

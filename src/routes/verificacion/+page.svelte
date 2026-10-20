<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordInput from '#lib/components/PasswordInput.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** What the password gave: kept while the code is asked for, and the recovery codes after. */
	let setup = $state<{ uri: string; secret: string; qr: string; codes: string[] } | null>(null);
	$effect(() => {
		if (form?.uri)
			setup = {
				uri: form.uri,
				secret: form.secret ?? '',
				qr: form.qr ?? '',
				codes: form.codes ?? []
			};
	});
	const confirmed = $derived(Boolean(form && 'confirmed' in form && form.confirmed));

	let copied = $state(false);
	const codesText = $derived(
		setup
			? `JellyCartoon: códigos de recuperación de la verificación en dos pasos.\nCada uno sirve una vez, si no tienes la app a mano.\n\n${setup.codes.join('\n')}\n`
			: ''
	);
	async function copyCodes() {
		await navigator.clipboard.writeText(codesText).catch(() => {});
		copied = true;
	}
	function downloadCodes() {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([codesText], { type: 'text/plain' }));
		a.download = 'jellycartoon-codigos-de-recuperacion.txt';
		a.click();
		URL.revokeObjectURL(a.href);
	}

	const box =
		'rounded-md border-zinc-700 bg-zinc-900 text-zinc-100 focus:border-amber-400 focus:ring-amber-400';
	const field = `block w-full ${box}`;
	/** Six figures: no wider than that. */
	const code = `w-40 ${box}`;
	const primary =
		'rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50';
	const secondary = 'rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900';
</script>

<svelte:head>
	<title>Verificación en dos pasos · JellyCartoon</title>
</svelte:head>

<div class="mx-auto mt-8 max-w-md space-y-6">
	<h1 class="text-2xl font-bold">Verificación en dos pasos</h1>

	{#if confirmed && setup}
		<p class="text-emerald-400">
			Activada: a partir de ahora, tras la contraseña te pedirá un código.
		</p>
		<section class="space-y-3 rounded-md border border-amber-500/40 p-4">
			<h2 class="font-semibold">Tus códigos de recuperación</h2>
			<p class="text-sm text-zinc-300">
				Si un día no tienes la app a mano, cada uno de estos te deja entrar una vez. Guárdalos
				<strong>fuera del móvil</strong>: en tu gestor de contraseñas, o en papel. No se vuelven a
				mostrar.
			</p>
			<ul class="grid grid-cols-2 gap-1 rounded bg-zinc-900 p-3 font-mono text-sm">
				{#each setup.codes as code (code)}
					<li>{code}</li>
				{/each}
			</ul>
			<div class="flex flex-wrap gap-2">
				<button class={secondary} onclick={copyCodes}>{copied ? 'Copiados' : 'Copiar'}</button>
				<button class={secondary} onclick={downloadCodes}>Descargar .txt</button>
			</div>
		</section>
		<a href="/" class="{primary} inline-block">Ya los he guardado</a>
	{:else if data.enabled}
		<p class="text-zinc-300">Ya la tienes activada.</p>
		<a href="/ajustes?seccion=cuenta" class="text-amber-400 hover:underline">← Ajustes</a>
	{:else if setup}
		<ol class="list-decimal space-y-4 pl-5 text-sm text-zinc-300">
			<li>
				En tu app de verificación (Proton Pass, Google Authenticator, Aegis…), añade una cuenta
				escaneando este código:
				<img
					src={setup.qr}
					alt="Código QR para la app de verificación"
					class="mt-3 h-48 w-48 rounded bg-white p-2"
				/>
				<p class="mt-3">O escribe a mano esta clave:</p>
				<p
					class="mt-1 rounded bg-zinc-900 px-3 py-2 font-mono text-base tracking-wide break-all text-zinc-100"
				>
					{setup.secret}
				</p>
				<details class="mt-2 text-xs text-zinc-500">
					<summary class="cursor-pointer">El enlace completo, para pegarlo en la app</summary>
					<p class="mt-1 font-mono break-all select-all">{setup.uri}</p>
				</details>
			</li>
			<li>
				Escribe el código de 6 cifras que te da ahora:
				<form method="post" action="?/confirm" use:enhance class="mt-2 flex gap-2">
					<!-- svelte-ignore a11y_autofocus -->
					<input
						name="code"
						required
						inputmode="numeric"
						pattern="[0-9 ]*"
						maxlength={7}
						autocomplete="one-time-code"
						autofocus
						aria-label="Código de la app"
						class="{code} font-mono text-lg tracking-widest"
					/>
					<button class={primary}>Comprobar</button>
				</form>
				{#if form && 'confirmProblem' in form}
					<p class="mt-2 text-red-400">{form.confirmProblem}</p>
				{/if}
			</li>
		</ol>
	{:else}
		<p class="text-zinc-300">
			{#if data.required}
				Antes de seguir: como administrador puedes cambiarlo todo en casa, así que tu cuenta lleva
				un segundo paso. Tras la contraseña, un código de 6 cifras de una app en tu móvil.
			{:else}
				Tras la contraseña, un código de 6 cifras de una app en tu móvil: aunque alguien sepa tu
				contraseña, sin el móvil no entra.
			{/if}
		</p>
		<p class="text-sm text-zinc-400">
			Sirve cualquier app de verificación: Proton Pass, Google Authenticator, Aegis, Microsoft
			Authenticator… En cada dispositivo puedes marcar «Recordar este dispositivo» para que no te lo
			pida en 90 días.
		</p>
		<form method="post" action="?/start" use:enhance class="space-y-3">
			<label class="block text-sm">
				Tu contraseña, para empezar
				<PasswordInput
					name="password"
					required
					autocomplete="current-password"
					box="mt-1"
					class={field}
				/>
			</label>
			{#if form && 'message' in form}
				<p class="text-sm text-red-400">{form.message}</p>
			{/if}
			<div class="flex items-center gap-4">
				<button class={primary}>Empezar</button>
				{#if data.required}
					<button formaction="/logout" formnovalidate class="text-sm text-zinc-400 hover:text-white"
						>Salir</button
					>
				{:else}
					<a href="/ajustes?seccion=cuenta" class="text-sm text-zinc-400 hover:text-white"
						>Ahora no</a
					>
				{/if}
			</div>
		</form>
	{/if}
</div>

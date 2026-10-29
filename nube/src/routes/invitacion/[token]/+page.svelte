<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import PasswordInput from 'comun/components/PasswordInput.svelte';
	import { field } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const inv = $derived(data.invitation);
	/** Into a family that is; otherwise, one of their own to name. */
	const ownFamily = $derived(!inv.familyName);
	const mine = $derived(data.me?.email.toLowerCase() === inv.email.toLowerCase());
	const until = $derived(
		inv.expiresAt.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
	);
	let busy = $state(false);
	const sending = () => {
		busy = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			busy = false;
		};
	};

	const input = `mt-1 ${field}`;
	const primary =
		'w-full rounded-md bg-amber-500 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50';
	const loginHere = $derived(`/login?next=${encodeURIComponent(page.url.pathname)}`);
</script>

<svelte:head>
	<title>Invitación · Seilide</title>
</svelte:head>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="text-center text-3xl font-bold text-amber-400">Seilide</h1>

	{#if inv.status !== 'pending'}
		<p class="mt-8 rounded-md border border-zinc-800 p-4 text-center text-zinc-300">
			{#if inv.status === 'accepted'}
				Esta invitación ya se usó. <a href="/login" class="text-amber-400 hover:underline">Entrar</a
				>
			{:else if inv.status === 'expired'}
				Esta invitación caducó. Pide que te la manden otra vez.
			{:else}
				Esta invitación se canceló.
			{/if}
		</p>
	{:else}
		<p class="mt-2 mb-8 text-center text-zinc-300">
			{#if ownFamily}
				Ya tienes acceso: crea tu familia, y luego invita a los tuyos desde Ajustes.
			{:else}
				{inv.inviterName ?? 'Te'}{inv.inviterName ? ' te' : ''} invita a la familia
				<strong>{inv.familyName}</strong>{inv.role === 'admin' ? ', para administrarla' : ''}.
			{/if}
			<span class="block text-sm text-zinc-500">Vale hasta el {until}.</span>
		</p>

		{#snippet familyName()}
			{#if ownFamily}
				<label class="block text-sm">
					El nombre de tu familia
					<input
						name="familyName"
						required
						maxlength={60}
						placeholder="Casa García"
						class={input}
					/>
				</label>
			{/if}
		{/snippet}

		{#if data.me}
			{#if mine}
				<form method="post" action="?/accept" use:enhance={sending} class="space-y-4">
					{@render familyName()}
					{#if form?.message}<p class="text-sm text-red-400">{form.message}</p>{/if}
					<button disabled={busy} class={primary}>
						{ownFamily ? 'Crear mi familia' : 'Unirme a la familia'}
					</button>
				</form>
			{:else}
				<p class="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
					Has entrado como {data.me.email}, y la invitación es para <strong>{inv.email}</strong>.
				</p>
				<form
					method="post"
					action="/logout?next={encodeURIComponent(page.url.pathname)}"
					class="mt-4"
				>
					<button class={primary}>Salir, para usarla</button>
				</form>
			{/if}
		{:else if inv.hasAccount}
			<p class="mb-4 text-center text-sm text-zinc-400">
				{inv.email} ya tiene cuenta: entra con ella para aceptarla.
			</p>
			<a href={loginHere} class="block text-center {primary}">Entrar</a>
		{:else}
			<form method="post" action="?/signUp" use:enhance={sending} class="space-y-4">
				<label class="block text-sm">
					Email
					<input value={inv.email} disabled class="{input} opacity-70" />
				</label>
				<label class="block text-sm">
					Tu nombre
					<input name="name" required maxlength={60} autocomplete="name" class={input} />
				</label>
				<label class="block text-sm">
					Contraseña
					<PasswordInput
						name="password"
						required
						minlength={10}
						box="mt-1"
						class={field}
						autocomplete="new-password"
					/>
				</label>
				{@render familyName()}
				{#if form?.message}<p class="text-sm text-red-400">{form.message}</p>{/if}
				<button disabled={busy} class={primary}>
					{ownFamily ? 'Crear mi cuenta y mi familia' : 'Crear mi cuenta'}
				</button>
			</form>
			<p class="mt-4 text-center text-sm text-zinc-400">
				¿Ya tienes cuenta con este email? <a href={loginHere} class="text-amber-400 hover:underline"
					>Entrar</a
				>
			</p>
		{/if}
	{/if}
</div>

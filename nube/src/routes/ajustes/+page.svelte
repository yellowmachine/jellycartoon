<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordInput from '#lib/components/PasswordInput.svelte';
	import { field, primary, secondary, section } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const admin = $derived(Boolean(data.family?.admin));
	const day = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
</script>

<h1 class="mb-6 text-2xl font-bold">Ajustes</h1>

<section class={section} id="casa">
	<h2 class="mb-1 font-semibold">Tu casa</h2>
	<p class="mb-4 text-sm text-zinc-400">
		La música y las series de tu jellycartoon, por su túnel: su dirección de fuera (<code
			>MEDIA_HOST</code
		>) y la clave que da en Ajustes → Casa → «La nube». La clave se guarda cifrada y no sale de este
		servidor.
	</p>

	{#if data.house}
		<p class="mb-4 text-sm">
			<span class="font-mono">{data.house.url}</span>
			<span class="block text-xs text-zinc-500">
				clave <span class="font-mono">{data.house.keyStart}</span> · cambiada el {day(
					data.house.updatedAt
				)}
			</span>
		</p>
	{/if}

	{#if admin}
		<form method="post" action="?/saveHouse" use:enhance class="mb-4 space-y-3">
			<label class="block text-sm">
				Dirección
				<input
					name="url"
					required
					placeholder="https://media.tu-dominio.com"
					value={data.house?.url ?? ''}
					class="mt-1 {field} font-mono"
				/>
			</label>
			<label class="block text-sm">
				Clave {#if data.house}<span class="text-zinc-500">(vacía, la de ahora)</span>{/if}
				<PasswordInput
					name="key"
					required={!data.house}
					autocomplete="off"
					box="mt-1"
					class="{field} font-mono"
				/>
			</label>
			<button class={primary}>Guardar</button>
		</form>
	{/if}

	{#if data.house}
		<div class="flex flex-wrap gap-2">
			<form method="post" action="?/testHouse" use:enhance>
				<button class={secondary}>Probar</button>
			</form>
			{#if admin}
				<form method="post" action="?/forgetHouse" use:enhance>
					<button class={secondary}>Desconectar</button>
				</form>
			{/if}
		</div>
	{/if}
	{#if form && 'houseOk' in form}
		<p class="mt-3 text-sm text-green-400">✓ {form.houseOk}</p>
	{/if}
	{#if form && 'houseProblem' in form}
		<p class="mt-3 text-sm text-red-400">{form.houseProblem}</p>
	{/if}
</section>

<section class={section} id="dos-pasos">
	<h2 class="mb-1 font-semibold">Verificación en dos pasos</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Tras la contraseña, un código de una app (Proton Pass, Aegis, Google Authenticator…). Esta app
		está en internet: mejor con ella.
	</p>

	{#if data.twoFactor}
		<p class="mb-3 text-sm text-green-400">✓ Activada</p>
		<form method="post" action="?/disableTwoFactor" use:enhance class="flex gap-2">
			<PasswordInput
				name="password"
				required
				placeholder="Tu contraseña"
				autocomplete="current-password"
				box="flex-1"
				class={field}
			/>
			<button class={secondary}>Quitar</button>
		</form>
	{:else if form && 'totpQr' in form}
		<p class="mb-2 text-sm">1. Escanea el código con tu app:</p>
		<img
			src={form.totpQr}
			alt="Código QR para la app de verificación"
			class="mb-2 rounded bg-white p-2"
		/>
		<p class="mb-4 font-mono text-xs break-all text-zinc-500 select-all">{form.totpURI}</p>
		<p class="mb-2 text-sm">
			2. Guarda estos códigos de recuperación, uno por cada vez sin el móvil:
		</p>
		<ul class="mb-4 grid grid-cols-2 gap-1 font-mono text-sm text-amber-300 select-all">
			{#each form.backupCodes as code (code)}<li>{code}</li>{/each}
		</ul>
		<p class="mb-2 text-sm">3. Escribe el código que da ahora la app:</p>
		<form method="post" action="?/confirmTwoFactor" use:enhance class="flex gap-2">
			<input
				name="code"
				required
				inputmode="numeric"
				autocomplete="one-time-code"
				class="{field} flex-1 font-mono tracking-widest"
			/>
			<button class={primary}>Activar</button>
		</form>
	{:else}
		<form method="post" action="?/enableTwoFactor" use:enhance class="flex gap-2">
			<PasswordInput
				name="password"
				required
				placeholder="Tu contraseña"
				autocomplete="current-password"
				box="flex-1"
				class={field}
			/>
			<button class={primary}>Empezar</button>
		</form>
	{/if}
	{#if form && 'twoFactorProblem' in form}
		<p class="mt-3 text-sm text-red-400">{form.twoFactorProblem}</p>
	{/if}
</section>

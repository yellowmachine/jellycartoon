<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordInput from 'comun/components/PasswordInput.svelte';
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
		<!-- Not emptied after saving (SvelteKit resets a form by default): what is saved stays in view. -->
		<form
			method="post"
			action="?/saveHouse"
			use:enhance={() =>
				({ update }) =>
					update({ reset: false })}
			class="mb-4 space-y-3"
		>
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
				Dirección de jellycartoon <span class="text-zinc-500">(opcional)</span>
				<input
					name="webUrl"
					placeholder="https://jellycartoon.tu-dominio.com"
					value={data.house?.webUrl ?? ''}
					class="mt-1 {field} font-mono"
				/>
				<span class="mt-1 block text-xs text-zinc-500">
					La de la app en casa: las secciones de casa del menú (Series, Cine…) llevan allí. Solo
					abre en casa o con la VPN.
				</span>
			</label>
			<label class="block text-sm">
				Clave {#if data.house}<span class="text-zinc-500">(vacía, la de ahora)</span>{/if}
				<PasswordInput
					name="key"
					required={!data.house}
					autocomplete="new-password"
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

<section class={section} id="clave-casa">
	<h2 class="mb-1 font-semibold">Clave para la casa</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Para que jellycartoon use la nevera y las recetas de aquí: su voz («apunta leche», «vamos a
		hacer los macarrones») y su tele. Se pega en su Ajustes → Casa → «La nube». Al revés que la de
		arriba: esta la da la nube a la casa.
	</p>

	{#if form && 'houseKey' in form}
		<div class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
			<p class="mb-1">Clave de «{form.houseKeyName}»:</p>
			<p class="font-mono break-all text-amber-300 select-all">{form.houseKey}</p>
			<p class="mt-1 text-xs text-zinc-400">Cópiala ahora: no se vuelve a enseñar.</p>
		</div>
	{/if}

	{#if data.houseKeys.length}
		<ul class="mb-4 divide-y divide-zinc-800 text-sm">
			{#each data.houseKeys as k (k.id)}
				<li class="flex items-center justify-between gap-2 py-2">
					<span>
						{k.name}
						<span class="block text-xs text-zinc-500">
							<span class="font-mono">{k.start}…</span> · creada el {day(k.createdAt)}
							{#if k.lastUsedAt}· usada el {day(k.lastUsedAt)}{:else}· sin usar{/if}
						</span>
					</span>
					{#if admin}
						<form method="post" action="?/deleteHouseKey" use:enhance>
							<input type="hidden" name="id" value={k.id} />
							<button class={secondary}>Quitar</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if admin}
		<form method="post" action="?/createHouseKey" use:enhance class="flex gap-2">
			<input
				name="name"
				maxlength="32"
				required
				placeholder="Casa"
				class="{field} min-w-0 flex-1"
			/>
			<button class={primary}>Nueva clave</button>
		</form>
	{/if}
	{#if form && 'houseKeyProblem' in form}
		<p class="mt-3 text-sm text-red-400">{form.houseKeyProblem}</p>
	{/if}
</section>

<section class={section} id="ia">
	<h2 class="mb-1 font-semibold">IA (OpenRouter)</h2>
	<p class="mb-4 text-sm text-zinc-400">
		La clave de <a
			href="https://openrouter.ai/keys"
			target="_blank"
			rel="noreferrer"
			class="text-amber-400 hover:underline">OpenRouter</a
		> de la familia: con ella las recetas guardadas quedan con pasos cortos y sus temporizadores, y se
		leen páginas sin datos de receta. Se guarda cifrada.
	</p>
	{#if data.openRouter}
		<p class="mb-3 font-mono text-sm">{data.openRouter}</p>
	{/if}
	{#if admin}
		<form method="post" action="?/saveOpenRouter" use:enhance class="flex gap-2">
			<PasswordInput
				name="key"
				placeholder={data.openRouter ? 'Otra clave (vacía, quitarla)' : 'sk-or-…'}
				autocomplete="new-password"
				box="flex-1"
				class="{field} font-mono"
			/>
			<button class={primary}>Guardar</button>
		</form>
	{/if}
	{#if form && 'openRouterProblem' in form}
		<p class="mt-3 text-sm text-red-400">{form.openRouterProblem}</p>
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

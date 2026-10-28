<script lang="ts">
	import { enhance } from '$app/forms';
	import AvatarPicker from 'comun/components/AvatarPicker.svelte';
	import PasswordInput from 'comun/components/PasswordInput.svelte';
	import PushNotices from 'comun/components/PushNotices.svelte';
	import TelegramBot from './TelegramBot.svelte';
	import VozCaracter from './VozCaracter.svelte';
	import VozInternet from './VozInternet.svelte';
	import VozSilencio from './VozSilencio.svelte';
	import Guardado from 'comun/components/Guardado.svelte';
	import { avatar, isAvatar } from 'comun/avatars.ts';
	import { field, primary, secondary, section } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const admin = $derived(Boolean(data.family?.admin));
	const day = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
	/** The person being changed, or `nueva` for one being added. */
	let editingPerson = $state<number | 'nueva' | null>(null);
</script>

<h1 class="mb-6 text-2xl font-bold">Ajustes</h1>

<section class={section} id="personas">
	<h2 class="mb-1 font-semibold">Personas</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Para quién es cada cosa de la Agenda y cada alarma: los de la familia con cuenta y los peques,
		que no la tienen. Cada uno con su dibujo.
	</p>
	<ul class="mb-4 divide-y divide-zinc-800">
		{#each data.people as p (p.id)}
			{@const drawing = isAvatar(p.avatar) ? avatar(p.avatar) : null}
			<li class="py-2">
				<div class="flex items-center gap-3">
					<span
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg {drawing?.color ??
							'bg-zinc-700'}">{drawing?.emoji ?? p.name.slice(0, 1)}</span
					>
					<span class="min-w-0 flex-1 truncate"
						>{p.name}
						<span class="text-xs text-zinc-500">{p.account ? '· con cuenta' : '· sin cuenta'}</span
						></span
					>
					<button
						class={secondary}
						onclick={() => (editingPerson = editingPerson === p.id ? null : p.id)}>Cambiar</button
					>
					{#if !p.account}
						<form method="post" action="?/deletePerson" use:enhance>
							<input type="hidden" name="id" value={p.id} />
							<button class={secondary}>Quitar</button>
						</form>
					{/if}
				</div>
				{#if editingPerson === p.id}
					<form
						method="post"
						action="?/updatePerson"
						class="mt-3 flex flex-col gap-3"
						use:enhance={() =>
							async ({ result, update }) => {
								if (result.type === 'success') editingPerson = null;
								await update();
							}}
					>
						<input type="hidden" name="id" value={p.id} />
						{#if p.account}
							<input type="hidden" name="name" value={p.name} />
						{:else}
							<input name="name" value={p.name} maxlength="40" required class={field} />
						{/if}
						<AvatarPicker chosen={p.avatar} label="Su dibujo" />
						<button class="{primary} self-start">Guardar</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
	{#if editingPerson === 'nueva'}
		<form
			method="post"
			action="?/addPerson"
			class="flex flex-col gap-3"
			use:enhance={() =>
				async ({ result, update }) => {
					if (result.type === 'success') editingPerson = null;
					await update();
				}}
		>
			<input name="name" placeholder="Su nombre" maxlength="40" required class={field} />
			<AvatarPicker chosen={null} label="Su dibujo" />
			<div class="flex gap-2">
				<button class={primary}>Añadir</button>
				<button type="button" class={secondary} onclick={() => (editingPerson = null)}
					>Cancelar</button
				>
			</div>
		</form>
	{:else}
		<button class={secondary} onclick={() => (editingPerson = 'nueva')}>+ Persona sin cuenta</button
		>
	{/if}
	{#if form && 'personProblem' in form}
		<p class="mt-3 text-sm text-red-400">{form.personProblem}</p>
	{/if}
</section>

<section class={section} id="avisos">
	<h2 class="mb-1 font-semibold">Este dispositivo</h2>
	<PushNotices about="cuando suena una alarma, y los avisos de la Agenda" />
</section>

<TelegramBot {data} {form} />

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

<section class={section} id="rutas">
	<h2 class="mb-1 font-semibold">Rutas (openrouteservice)</h2>
	<p class="mb-4 text-sm text-zinc-400">
		La clave de <a
			href="https://openrouteservice.org/dev/#/signup"
			target="_blank"
			rel="noreferrer"
			class="text-amber-400 hover:underline">openrouteservice</a
		> de la familia, gratis: con ella el modo carretera busca sitios y traza la ruta en coche, con sus
		indicaciones. Su plan gratuito da unas 2.000 rutas y 1.000 búsquedas al día. Se guarda cifrada.
	</p>
	{#if data.ors}
		<p class="mb-3 font-mono text-sm">{data.ors}</p>
	{/if}
	{#if admin}
		<form method="post" action="?/saveOrs" use:enhance class="flex gap-2">
			<PasswordInput
				name="key"
				placeholder={data.ors ? 'Otra clave (vacía, quitarla)' : 'La clave de openrouteservice'}
				autocomplete="new-password"
				box="flex-1"
				class="{field} font-mono"
			/>
			<button class={primary}>Guardar</button>
		</form>
	{/if}
	{#if form && 'orsProblem' in form}
		<p class="mt-3 text-sm text-red-400">{form.orsProblem}</p>
	{/if}
</section>

{#if data.voiceModel}
	<section class={section} id="voz">
		<h2 class="mb-1 font-semibold">La voz</h2>
		<p class="mb-3 text-sm text-zinc-400">
			La voz de casa (el móvil, la tablet, los satélites) piensa aquí, con la clave de OpenRouter de
			la familia: lo que se le dice llega de casa como texto y casa hace lo suyo (la música, los
			vídeos, los temporizadores). Su modelo: mejor uno rápido, porque se espera con el móvil en la
			mano, y que use bien las herramientas.
		</p>
		<form
			method="post"
			action="?/saveVoiceModel"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="flex flex-wrap gap-2"
		>
			<input
				name="model"
				value={data.voiceModel.model}
				placeholder={data.voiceModel.fallback}
				aria-label="Modelo para la voz"
				class="{field} min-w-0 flex-1 font-mono"
			/>
			<button class={secondary}>Guardar</button>
			{#if form && 'saved' in form && form.saved === 'voiceModel'}
				<Guardado class="self-center text-sm text-amber-400">✓</Guardado>
			{/if}
		</form>
		<p class="mt-1 text-xs text-zinc-500">
			Vacío usa {data.voiceModel.fallback}. Los identificadores están en
			<a
				href="https://openrouter.ai/models"
				class="hover:underline"
				target="_blank"
				rel="noreferrer">openrouter.ai/models</a
			>.
		</p>
		{#if form && 'voiceProblem' in form}
			<p class="mt-3 text-sm text-red-400">{form.voiceProblem}</p>
		{/if}
	</section>
{/if}

<VozCaracter {data} {form} which="casa" />
<VozInternet {data} {form} />
<VozSilencio {data} {form} />
<VozCaracter {data} {form} which="mio" />

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

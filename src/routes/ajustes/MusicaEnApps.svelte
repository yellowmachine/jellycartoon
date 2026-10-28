<script lang="ts">
	import { enhance } from '$app/forms';
	import { section, primary, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Música en apps Subsonic: su contraseña aparte. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

{#if data.musicApps}
	{@const apps = data.musicApps}
	<section class={section} id="musica-en-apps">
		<h2 class="mb-1 font-semibold">Música en apps</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Para escuchar tu música en apps que hablan Subsonic, como
			<a
				href="https://github.com/eddyizm/tempus"
				target="_blank"
				rel="noreferrer"
				class="text-amber-400 hover:underline">Tempus</a
			>, también en el coche con Android Auto. Con una contraseña solo para eso, aparte de la de tu
			cuenta.
		</p>
		<dl class="mb-4 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
			{#if apps.away}
				<!-- Through the tunnel, at home too; the other only reaches from home or the VPN. -->
				<dt class="text-zinc-400">Servidor</dt>
				<dd class="font-mono break-all">{apps.away}</dd>
				<dt class="text-zinc-400">Solo en casa o con la VPN</dt>
				<dd class="font-mono break-all">{apps.server}</dd>
			{:else}
				<dt class="text-zinc-400">Servidor</dt>
				<dd class="font-mono break-all">{apps.server}</dd>
			{/if}
			<dt class="text-zinc-400">Usuario</dt>
			<dd class="font-mono break-all">{apps.username}</dd>
			<dt class="text-zinc-400">Contraseña</dt>
			<dd>
				{#if form && 'appPassword' in form}
					<span class="font-mono text-amber-300 select-all">{form.appPassword}</span>
					<span class="block text-xs text-zinc-400">
						Cópiala ahora en la app: no se vuelve a enseñar.
					</span>
				{:else if apps.since}
					Creada el {apps.since.toLocaleDateString('es')}
				{:else}
					<span class="text-zinc-400">Ninguna</span>
				{/if}
			</dd>
		</dl>
		<div class="flex flex-wrap gap-2">
			<form method="post" action="?seccion={tab}&/appPassword" use:enhance>
				<button class={primary}>{apps.since ? 'Generar otra' : 'Generar contraseña'}</button>
			</form>
			{#if apps.since}
				<form method="post" action="?seccion={tab}&/revokeAppPassword" use:enhance>
					<button class={secondary}>Quitar</button>
				</form>
			{/if}
		</div>
		{#if apps.since}
			<p class="mt-2 text-xs text-zinc-500">
				Generar otra deja sin acceso a las apps que usaban la anterior.{#if !apps.away}
					Fuera de casa, el móvil necesita la VPN conectada.{/if}
			</p>
		{/if}
	</section>
{/if}

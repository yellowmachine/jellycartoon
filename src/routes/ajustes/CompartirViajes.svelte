<script lang="ts">
	import { enhance } from '$app/forms';
	import { section, select, primary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Compartir viajes: el repetidor. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

{#if data.relay}
	<section class={section} id="compartir-viajes">
		<h2 class="mb-1 font-semibold">Compartir viajes</h2>
		<p class="mb-4 text-sm text-zinc-400">
			El modo carretera puede compartir el viaje con un enlace (para un grupo de WhatsApp, por
			ejemplo): quien lo abre ve el coche en el mapa mientras lo compartes. Pasa por un repetidor en
			un servidor público (<code>relay/</code> del repositorio), sin abrir la casa. Su dirección y
			la clave que espera (su <code>PUBLISH_KEY</code>). Solo tú ves esta sección.
		</p>
		{#if data.relay.fromEnv}
			<p class="text-sm">
				Configurado en el <code>.env</code> (RELAY_URL, RELAY_PUBLISH_KEY){data.relay.url
					? ` · ${data.relay.url}`
					: ''}.
			</p>
		{:else}
			<form
				method="post"
				action="?seccion={tab}&/saveRelay"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
				class="flex flex-col gap-2"
			>
				<input
					name="url"
					value={data.relay.url}
					placeholder="https://viaje.example.com"
					aria-label="Dirección del repetidor"
					class="{select} font-mono"
				/>
				<input
					type="password"
					name="key"
					autocomplete="new-password"
					placeholder={data.relay.hasKey
						? 'Clave guardada (escribe otra para cambiarla)'
						: 'Clave (PUBLISH_KEY)'}
					aria-label="Clave del repetidor"
					class="{select} font-mono"
				/>
				<div class="flex items-center gap-3">
					<button class={primary}>Guardar</button>
					{#if form && 'saved' in form && form.saved === 'relay'}
						<span class="text-sm text-amber-400">✓</span>
					{/if}
				</div>
			</form>
		{/if}
		{#if form && 'section' in form && form.section === 'relay'}
			<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
		{/if}
	</section>
{/if}

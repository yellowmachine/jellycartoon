<script lang="ts">
	import Guardado from './Guardado.svelte';
	import { enhance } from '$app/forms';
	import { section, select, primary, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Rutas del modo carretera: openrouteservice. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

{#if data.routes}
	<section class={section} id="rutas">
		<h2 class="mb-1 font-semibold">Rutas del modo carretera</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Con una clave gratuita de <a
				href="https://openrouteservice.org"
				class="text-amber-400 hover:underline"
				target="_blank"
				rel="noreferrer">openrouteservice</a
			>
			el modo carretera busca el destino y traza la ruta con sus pasos, en el mapa. La clave se queda
			en el servidor. Solo tú ves esta sección.
		</p>

		<h3 class="mb-2 text-sm text-zinc-300">Clave</h3>
		{#if data.routes.keySource === 'env'}
			<p class="mb-4 text-sm">
				Configurada en el <code>.env</code> (OPENROUTESERVICE_API_KEY) · {data.routes.keyHint}.
			</p>
		{:else}
			{#if data.routes.keyHint}
				<div class="mb-3 flex items-center gap-3 text-sm">
					<span>Configurada · <span class="font-mono">{data.routes.keyHint}</span></span>
					<form method="post" action="?seccion={tab}&/deleteOrsKey" use:enhance>
						<button class="text-red-400 hover:underline">Borrar</button>
					</form>
				</div>
			{/if}
			<form
				method="post"
				action="?seccion={tab}&/saveOrsKey"
				use:enhance
				class="mb-4 flex flex-wrap gap-2"
			>
				<input
					type="password"
					name="key"
					autocomplete="new-password"
					placeholder={data.routes.keyHint ? 'Nueva clave' : 'Clave de openrouteservice'}
					aria-label="Clave de openrouteservice"
					class="{select} min-w-0 flex-1 font-mono"
				/>
				<button class={primary}>{data.routes.keyHint ? 'Cambiar' : 'Guardar'}</button>
			</form>
		{/if}

		<h3 class="mb-2 text-sm text-zinc-300">Dirección</h3>
		<form
			method="post"
			action="?seccion={tab}&/saveOrsUrl"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="mb-1 flex flex-wrap gap-2"
		>
			<input
				name="url"
				value={data.routes.url}
				placeholder={data.routes.defaultUrl}
				aria-label="Dirección de openrouteservice"
				class="{select} min-w-0 flex-1 font-mono"
			/>
			<button class={secondary}>Guardar</button>
			{#if form && 'saved' in form && form.saved === 'orsUrl'}
				<Guardado class="self-center text-sm text-amber-400">✓</Guardado>
			{/if}
		</form>
		<p class="text-xs text-zinc-500">
			Vacía usa el suyo. Si te alojas uno propio (Docker), su dirección: las rutas salen de tu casa,
			sin cuotas (la búsqueda de sitios sigue necesitando el suyo).
		</p>
		{#if form && 'section' in form && form.section === 'routes'}
			<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
		{/if}
	</section>
{/if}

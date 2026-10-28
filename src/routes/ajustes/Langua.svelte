<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { enhance } from '$app/forms';
	import { section, select, primary, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Langua, tu app de idiomas: dirección y token. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

{#if data.langua}
	<section class={section} id="langua">
		<h2 class="mb-1 font-semibold">Langua</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Tu app de idiomas. {data.voice
				? 'Desde Hablar se le manda el audio de lo que estás viendo, con su texto: «manda los últimos 5 minutos a Langua».'
				: 'Se le manda el audio de lo que estás viendo, con su texto.'} El token se crea en Langua, en
			Mi cuenta → Integraciones.
		</p>
		<form
			method="post"
			action="?seccion={tab}&/saveLangua"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center"
		>
			<label for="languaUrl" class="text-sm text-zinc-300">Dirección</label>
			<input
				id="languaUrl"
				name="url"
				type="url"
				autocomplete="url"
				value={data.langua.url ?? ''}
				placeholder="https://langua.scholio.review"
				class={select}
			/>
			<label for="languaToken" class="text-sm text-zinc-300">Token</label>
			<input
				id="languaToken"
				name="token"
				type="password"
				autocomplete="new-password"
				placeholder={data.langua.tokenHint
					? `Guardado (${data.langua.tokenHint}): escribe otro para cambiarlo`
					: 'lng_…'}
				class="{select} font-mono"
			/>
			<div class="flex flex-wrap items-center gap-3 sm:col-start-2">
				<button class={primary}>Guardar</button>
				{#if data.langua.tokenHint}
					<button class={secondary} formaction="?seccion={tab}&/testLangua">Probar</button>
					<button
						class="text-sm text-red-400 hover:underline"
						formaction="?seccion={tab}&/forgetLangua">Olvidar</button
					>
				{/if}
				{#if form && 'saved' in form && form.saved === 'langua'}
					<Guardado class="text-sm text-amber-400">✓ Guardado</Guardado>
				{:else if form && 'languaOk' in form}
					<Guardado class="text-sm text-amber-400">✓ Langua acepta el token</Guardado>
				{/if}
			</div>
		</form>
		{#if form && 'section' in form && form.section === 'langua'}
			<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
		{/if}
	</section>
{/if}

<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { enhance } from '$app/forms';
	import { field, primary, secondary, section } from '#lib/styles.ts';
	import type { ActionData, PageData } from './$types';

	/**
	 * Noticias (#428): their Miniflux, for a card on the home page. The key is asked for on every
	 * save: with the one kept, a stolen session could send it to another address.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

<section class={section} id="noticias">
	<h2 class="mb-1 font-semibold">Noticias</h2>
	<p class="mb-3 text-sm text-zinc-400">
		Tus noticias sin leer de Miniflux, en el inicio. Al pulsar una, se abre su web y queda como
		leída. Solo las ves tú.
	</p>
	<!-- Not reset: the address stays as it is saved. The key, never left on the page. -->
	<form
		method="post"
		action="?seccion={tab}&/saveNews"
		use:enhance={({ formElement }) =>
			async ({ result, update }) => {
				await update({ reset: false });
				if (result.type === 'success') formElement.key.value = '';
			}}
		class="flex flex-col gap-3"
	>
		<label class="flex flex-col gap-1 text-sm text-zinc-300">
			Dirección de tu Miniflux
			<input
				name="url"
				type="url"
				required
				maxlength="500"
				placeholder="https://miniflux.example.org"
				value={form && 'newsUrl' in form ? form.newsUrl : (data.news ?? '')}
				class={field}
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm text-zinc-300">
			Clave de API
			<input
				name="key"
				type="password"
				required
				maxlength="500"
				autocomplete="new-password"
				placeholder={data.news ? 'Guardada' : ''}
				class={field}
			/>
			<span class="text-xs text-zinc-500">
				Se crea en Miniflux, en Settings → API Keys. No uses tu contraseña.
				{#if data.news}Para cambiar algo, escríbela otra vez.{/if}
			</span>
		</label>
		<div class="flex items-center gap-3">
			<button class={primary}>Guardar</button>
			{#if data.news}
				<button class={secondary} formaction="?seccion={tab}&/removeNews" formnovalidate
					>Quitar</button
				>
			{/if}
			{#if form && 'saved' in form && form.saved === 'news'}
				<Guardado class="text-amber-400">✓ Guardado</Guardado>
			{/if}
		</div>
		{#if form && 'newsProblem' in form}
			<p class="text-sm text-red-400">{form.newsProblem}</p>
		{/if}
		{#if form && 'saved' in form && form.saved === 'newsRemoved'}
			<p class="text-sm text-zinc-400">
				Quitado de Seilide. La clave sigue viva en Miniflux hasta que la borres allí.
			</p>
		{/if}
	</form>
</section>

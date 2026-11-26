<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { enhance } from '$app/forms';
	import { field, primary, secondary, section } from '#lib/styles.ts';
	import type { ActionData, PageData } from './$types';

	/**
	 * Noticias (#428, #638): their news reader, by the Google Reader API (Miniflux, FreshRSS…), for
	 * a card on the home page. The password is asked for on every save: with what is kept, a stolen
	 * session could send it to another address. Only its login token is kept, not the password.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

<section class={section} id="noticias">
	<h2 class="mb-1 font-semibold">Noticias</h2>
	<p class="mb-3 text-sm text-zinc-400">
		Las noticias sin leer de tu lector de noticias, en el inicio. Al pulsar una, se abre su web y
		queda como leída. Solo las ves tú. Sirve cualquier lector con la API de Google Reader, como
		Miniflux o FreshRSS.
	</p>
	<details class="mb-3 text-sm text-zinc-400">
		<summary class="cursor-pointer text-zinc-300">Cómo se activa en tu lector</summary>
		<ul class="mt-2 list-disc space-y-1 pl-5">
			<li>
				<strong>Miniflux:</strong> en Ajustes → Integraciones, activa «API de Google Reader» y elige un
				usuario y una contraseña para ella. La dirección es la de tu Miniflux.
			</li>
			<li>
				<strong>FreshRSS:</strong> quien lo administra permite el acceso por API, y tú pones una
				contraseña de API en Perfil. El usuario es el tuyo de FreshRSS, y la dirección, la de tu
				FreshRSS (o la que acaba en <code>/api/greader.php</code>).
			</li>
		</ul>
	</details>
	<!-- Not reset: the address and user stay as saved. The password, never left on the page. -->
	<form
		method="post"
		action="?seccion={tab}&/saveNews"
		use:enhance={({ formElement }) =>
			async ({ result, update }) => {
				await update({ reset: false });
				if (result.type === 'success') formElement.password.value = '';
			}}
		class="flex flex-col gap-3"
	>
		<label class="flex flex-col gap-1 text-sm text-zinc-300">
			Dirección de tu lector
			<input
				name="url"
				type="url"
				required
				maxlength="500"
				placeholder="https://noticias.example.org"
				value={form && 'newsUrl' in form ? form.newsUrl : (data.news?.url ?? '')}
				class={field}
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm text-zinc-300">
			Usuario
			<input
				name="username"
				required
				maxlength="200"
				autocomplete="username"
				value={form && 'newsUser' in form ? form.newsUser : (data.news?.username ?? '')}
				class={field}
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm text-zinc-300">
			Contraseña de API
			<input
				name="password"
				type="password"
				required
				maxlength="500"
				autocomplete="new-password"
				placeholder={data.news ? 'Guardada' : ''}
				class={field}
			/>
			<span class="text-xs text-zinc-500">
				La de la API de Google Reader, no la de entrar en tu lector. Seilide no la guarda: solo el
				permiso que le da tu lector al entrar.
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
				Quitado de Seilide. Para que el permiso deje de servir, cambia la contraseña de API en tu
				lector.
			</p>
		{/if}
	</form>
</section>

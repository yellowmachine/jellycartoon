<script lang="ts">
	import { enhance } from '$app/forms';
	import { languageLabel } from '#lib/languages.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let testing = $state(false);

	const section = 'mb-8 rounded-md border border-zinc-800 p-4';
	const select = 'rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm';
	const primary =
		'rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50';
	const secondary = 'rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900';
</script>

<svelte:head>
	<title>Ajustes · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="mb-6 text-2xl font-bold">Ajustes</h1>

	<section class={section}>
		<h2 class="mb-1 font-semibold">Reproducción</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Idiomas que se eligen al empezar un capítulo o una película. El estilo de los subtítulos se
			cambia desde el reproductor.
		</p>
		<form
			method="post"
			action="?/playback"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center"
		>
			<label for="audioLang" class="text-sm text-zinc-300">Audio</label>
			<select id="audioLang" name="audioLang" value={data.playback.audioLang ?? ''} class={select}>
				<option value="">El del vídeo</option>
				{#each data.languages as code (code)}
					<option value={code}>{languageLabel(code)}</option>
				{/each}
			</select>
			<label for="subtitleLang" class="text-sm text-zinc-300">Subtítulos</label>
			<select
				id="subtitleLang"
				name="subtitleLang"
				value={data.playback.subtitleLang ?? ''}
				class={select}
			>
				<option value="">Sin subtítulos</option>
				{#each data.languages as code (code)}
					<option value={code}>{languageLabel(code)}</option>
				{/each}
			</select>
			<div class="flex items-center gap-3 sm:col-start-2">
				<button class={primary}>Guardar</button>
				{#if form && 'saved' in form && form.saved === 'playback'}
					<span class="text-sm text-amber-400">✓ Guardado</span>
				{/if}
			</div>
		</form>
	</section>

	{#if data.ai}
		<section class={section}>
			<h2 class="mb-1 font-semibold">Inteligencia artificial</h2>
			<p class="mb-4 text-sm text-zinc-400">
				Con una clave de <a
					href="https://openrouter.ai/keys"
					class="text-amber-400 hover:underline"
					target="_blank"
					rel="noreferrer">OpenRouter</a
				>
				se identifica cada película a partir del nombre del fichero, para su ficha, y se le puede preguntar
				sobre ella. Solo tú ves esta sección.
			</p>

			<h3 class="mb-2 text-sm text-zinc-300">Clave</h3>
			{#if data.ai.keySource === 'env'}
				<p class="mb-4 text-sm">
					Configurada en el <code>.env</code> (OPENROUTER_API_KEY) · {data.ai.keyHint}. Para
					cambiarla, edita el
					<code>.env</code>.
				</p>
			{:else}
				{#if data.ai.keyHint}
					<div class="mb-3 flex items-center gap-3 text-sm">
						<span>Configurada · <span class="font-mono">{data.ai.keyHint}</span></span>
						<form method="post" action="?/deleteKey" use:enhance>
							<button class="text-red-400 hover:underline">Borrar</button>
						</form>
					</div>
				{/if}
				<form method="post" action="?/saveKey" use:enhance class="mb-4 flex flex-wrap gap-2">
					<input
						type="password"
						name="key"
						autocomplete="off"
						placeholder={data.ai.keyHint ? 'Nueva clave' : 'sk-or-…'}
						aria-label="Clave de OpenRouter"
						class="{select} min-w-0 flex-1 font-mono"
					/>
					<button class={primary}>{data.ai.keyHint ? 'Cambiar' : 'Guardar'}</button>
				</form>
			{/if}

			{#snippet modelForm(use: 'films' | 'chat', label: string, value: string, fallback: string)}
				<form
					method="post"
					action="?/saveModel"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
					class="mb-1 flex flex-wrap gap-2"
				>
					<input type="hidden" name="use" value={use} />
					<input
						name="model"
						value={value === fallback ? '' : value}
						placeholder={fallback}
						aria-label={label}
						class="{select} min-w-0 flex-1 font-mono"
					/>
					<button class={secondary}>Guardar</button>
					{#if form && 'saved' in form && form.saved === (use === 'chat' ? 'chatModel' : 'model')}
						<span class="self-center text-sm text-amber-400">✓</span>
					{/if}
				</form>
			{/snippet}

			<h3 class="mb-2 text-sm text-zinc-300">Modelo para identificar películas</h3>
			{@render modelForm(
				'films',
				'Modelo para identificar películas',
				data.ai.model,
				data.ai.defaultModel
			)}
			<p class="mb-4 text-xs text-zinc-500">
				Vacío usa {data.ai.defaultModel}, barato y rápido. Los identificadores están en
				<a
					href="https://openrouter.ai/models"
					class="hover:underline"
					target="_blank"
					rel="noreferrer">openrouter.ai/models</a
				>.
			</p>

			<h3 class="mb-2 text-sm text-zinc-300">Modelo para conversar sobre películas</h3>
			{@render modelForm(
				'chat',
				'Modelo para conversar sobre películas',
				data.ai.chatModel,
				data.ai.defaultChatModel
			)}
			<p class="mb-3 text-xs text-zinc-500">
				Vacío usa {data.ai.defaultChatModel}. Cada pregunta lleva los artículos de Wikipedia de la
				película: unos pocos céntimos con este modelo.
			</p>
			<form
				method="post"
				action="?/saveChatWeb"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
				class="mb-4"
			>
				<label class="flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						name="web"
						checked={data.ai.chatWeb}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
						class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
					/>
					<span>
						Dejar que busque en la web
						<span class="block text-xs text-zinc-500"
							>Más completo y con enlaces a las fuentes, pero cuesta algo más por pregunta (unos 0,7
							céntimos de búsqueda, más el texto que lee).</span
						>
					</span>
				</label>
			</form>

			<form
				method="post"
				action="?/testAi"
				use:enhance={() => {
					testing = true;
					return async ({ update }) => {
						await update();
						testing = false;
					};
				}}
				class="flex items-center gap-3"
			>
				<button class={secondary} disabled={testing || !data.ai.keyHint}>
					{testing ? 'Probando…' : 'Probar clave y modelo'}
				</button>
				{#if form && 'tested' in form}
					<span class="text-sm text-amber-400">✓ Funciona con {data.ai.model}</span>
				{/if}
			</form>
			{#if form && 'section' in form && form.section === 'ai'}
				<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
			{/if}
		</section>
	{/if}

	<section class={section}>
		<h2 class="mb-3 font-semibold">Cuenta</h2>
		<form method="post" action="/logout" class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-sm">
				{data.account.name} · <span class="text-zinc-400">{data.account.email}</span>
			</p>
			<button class={secondary}>Salir</button>
		</form>
	</section>
</div>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { updated } from '$app/state';
	import { languageLabel } from '#lib/languages.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let testing = $state(false);

	/**
	 * While WUD updates (#20): asks every few seconds whether the new version is up, and then loads
	 * it. Meanwhile the app is restarting, so some of those questions fail: that is expected.
	 */
	const updating = $derived(Boolean(form && 'updating' in form && form.updating));
	$effect(() => {
		if (!updating) return;
		const timer = setInterval(async () => {
			if (await updated.check().catch(() => false)) location.reload();
		}, 5000);
		return () => clearInterval(timer);
	});

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
		{#if data.intro !== null}
			<form
				method="post"
				action="?/intro"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
				class="mt-4"
			>
				<label class="flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						name="intro"
						checked={data.intro}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
						class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
					/>
					<span>
						Cortinilla de Cine Club
						<span class="block text-xs text-zinc-500"
							>Antes de las películas que empiezan desde el principio en el salón. Se puede saltar
							desde el mando.</span
						>
					</span>
				</label>
			</form>
		{/if}
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

			{#snippet modelForm(
				use: 'films' | 'chat' | 'vision',
				label: string,
				value: string,
				fallback: string
			)}
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
					{#if form && 'saved' in form && form.saved === { films: 'model', chat: 'chatModel', vision: 'visionModel' }[use]}
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

			<h3 class="mb-2 text-sm text-zinc-300">Modelo para escenas y títulos de episodios</h3>
			{@render modelForm(
				'vision',
				'Modelo para escenas y títulos de episodios',
				data.ai.visionModel,
				data.ai.defaultVisionModel
			)}
			<p class="mb-4 text-xs text-zinc-500">
				Vacío usa {data.ai.defaultVisionModel}. Mira fotogramas: mejor uno que vea bien las imágenes
				y no razone antes de responder (los que razonan, como GPT-5 u o3, cuestan mucho más aquí).
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

	{#if data.kids}
		<section class={section}>
			<h2 class="mb-1 font-semibold">Cuentas infantiles</h2>
			<p class="mb-4 text-sm text-zinc-400">
				Solo ven las series y películas con la etiqueta «infantil», y no pueden gestionar nada ni
				hablar con la IA. Se crean aquí, y la propia cuenta no puede dejar de ser infantil. Solo tú
				ves esta sección.
			</p>
			{#if data.kids.length}
				<ul class="mb-4 divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
					{#each data.kids as kid (kid.id)}
						<li class="p-2">{kid.name} · <span class="text-zinc-400">{kid.email}</span></li>
					{/each}
				</ul>
			{/if}
			<form
				method="post"
				action="?/createKid"
				use:enhance
				class="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
			>
				<input name="name" required placeholder="Nombre" aria-label="Nombre" class={select} />
				<input
					name="email"
					type="email"
					required
					autocomplete="off"
					placeholder="lucia@casa.local"
					aria-label="Email para entrar"
					class={select}
				/>
				<input
					name="password"
					type="password"
					required
					minlength="8"
					autocomplete="new-password"
					placeholder="Contraseña"
					aria-label="Contraseña"
					class={select}
				/>
				<button class={primary}>Crear</button>
			</form>
			<p class="mt-2 text-xs text-zinc-500">
				El email solo sirve para entrar: no hace falta que exista.
			</p>
			{#if form && 'section' in form && form.section === 'kids'}
				<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
			{:else if form && 'saved' in form && form.saved === 'kids'}
				<p class="mt-3 text-sm text-amber-400">✓ Cuenta creada</p>
			{/if}
		</section>
	{/if}

	<section class={section} id="version">
		<h2 class="mb-1 font-semibold">Versión</h2>
		<p class="text-sm text-zinc-400">
			{#if data.version.release}
				Tienes la {data.version.current}.
			{:else}
				Versión de pruebas ({data.version.current.slice(0, 11)}): se actualiza con cada cambio, sin
				versiones numeradas.
			{/if}
		</p>
		{#if data.version.update}
			{@const update = data.version.update}
			<div class="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
				<p class="font-medium text-amber-300">Hay una versión nueva: la {update.version}</p>
				{#if update.notes}
					<p class="mt-2 max-h-64 overflow-y-auto text-sm whitespace-pre-line text-zinc-300">
						{update.notes}
					</p>
				{/if}
				<a
					href={update.url}
					target="_blank"
					rel="noreferrer"
					class="mt-2 inline-block text-sm text-amber-400 hover:underline">Ver en GitHub</a
				>
				{#if updating}
					<p class="mt-3 text-sm">
						Actualizando… La app se reinicia y esta página se recargará sola cuando esté lista.
						Puede tardar unos minutos.
					</p>
				{:else if data.version.canUpdate}
					<form
						method="post"
						action="?/update"
						use:enhance
						class="mt-3 flex flex-wrap items-center gap-3"
					>
						<button class={primary}>Actualizar ahora</button>
						<span class="text-xs text-zinc-400"
							>Antes se hace una copia de la base de datos. Si no, se instalará sola esta madrugada.</span
						>
					</form>
				{:else}
					<p class="mt-3 text-sm text-zinc-400">
						Para instalarla, en el equipo: <code>docker compose -f compose.prod.yaml pull</code> y
						<code>up -d</code>.
					</p>
				{/if}
				{#if form && 'section' in form && form.section === 'version'}
					<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
				{/if}
			</div>
		{/if}
	</section>

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

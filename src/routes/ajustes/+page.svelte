<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { DEVICE_NAME_MAX, deviceName, shownDeviceName } from '#lib/device-name.svelte.ts';
	import { micMode, type MicMode } from '#lib/mic-mode.svelte.ts';
	import { musicQuality, type MusicQuality } from '#lib/music-quality.svelte.ts';
	import MusicBackgroundSettings from '#lib/components/MusicBackgroundSettings.svelte';
	import PasswordInput from '#lib/components/PasswordInput.svelte';
	import SubtitleStylePanel from '#lib/components/SubtitleStylePanel.svelte';
	import type { SubtitleStyle } from '#lib/subtitle-style.ts';
	import UpdateProgress from '#lib/components/UpdateProgress.svelte';
	import { languageLabel } from '#lib/languages.ts';
	import { THEMES, themeSwatches } from '#lib/themes.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let testing = $state(false);

	/** WUD is updating (#20): UpdateProgress follows it, over the page. */
	const updating = $derived(Boolean(form && 'updating' in form && form.updating));

	/** After an update, the page loaded the new version: from which one, said once. */
	let justUpdated = $state<{ from: string; to: string } | null>(null);
	/** This device's name and what it is are only known in the browser. */
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
		try {
			const done = JSON.parse(sessionStorage.getItem('jellycartoon:updated') ?? 'null');
			sessionStorage.removeItem('jellycartoon:updated');
			if (done?.to === data.version.current) justUpdated = done;
		} catch {
			// Private window: no message, the version says it all the same.
		}
	});

	/**
	 * Grouped, so the page is not eleven sections in a row: what is yours, what is this browser's
	 * look and name, what connects to other apps, and what is the whole house's.
	 */
	const tabs = $derived([
		{ id: 'ver', label: 'Ver' },
		{ id: 'aspecto', label: 'Aspecto' },
		...(data.langua || data.musicApps ? [{ id: 'conexiones', label: 'Conexiones' }] : []),
		{ id: 'casa', label: 'Casa' },
		{ id: 'cuenta', label: 'Cuenta' }
	]);
	const tab = $derived(
		tabs.find((t) => t.id === page.url.searchParams.get('seccion'))?.id ?? 'ver'
	);

	const section = 'mb-8 rounded-md border border-zinc-800 p-4';
	const select = 'rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm';
	const primary =
		'rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50';
	const secondary = 'rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900';

	// Changed here at once; several quick clicks become one save, as in the player.
	let subtitleStyle = $derived(data.subtitleStyle);
	let styleTimer: ReturnType<typeof setTimeout> | undefined;
	let styleProblem = $state(false);
	function chooseSubtitleStyle(style: SubtitleStyle) {
		subtitleStyle = style;
		clearTimeout(styleTimer);
		styleTimer = setTimeout(async () => {
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ subtitleStyle: style })
			}).catch(() => null);
			styleProblem = !res?.ok;
		}, 400);
	}
</script>

<svelte:head>
	<title>Ajustes · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="mb-4 text-2xl font-bold">Ajustes</h1>

	<!-- Tabs that are links, as in Gestión: each keeps its address, and «back» works. -->
	<!-- Forms post to «?seccion=…&/action», so saving keeps the tab (the action is the «/» one). -->
	<nav class="mb-6 flex gap-5 overflow-x-auto border-b border-zinc-800">
		{#each tabs as t (t.id)}
			<a
				href="?seccion={t.id}"
				class={[
					'shrink-0 border-b-2 px-1 pb-2 text-sm',
					t.id === tab
						? 'border-amber-500 text-white'
						: 'border-transparent text-zinc-400 hover:text-white'
				]}
				aria-current={t.id === tab ? 'page' : undefined}>{t.label}</a
			>
		{/each}
	</nav>

	{#if tab === 'ver'}
		<section class={section}>
			<h2 class="mb-1 font-semibold">Reproducción</h2>
			<p class="mb-4 text-sm text-zinc-400">
				Idiomas que se eligen al empezar un capítulo o una película, y cómo se ven los subtítulos:
				en el navegador y en el salón.
			</p>
			<form
				method="post"
				action="?seccion={tab}&/playback"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
				class="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center"
			>
				<label for="audioLang" class="text-sm text-zinc-300">Audio</label>
				<select
					id="audioLang"
					name="audioLang"
					value={data.playback.audioLang ?? ''}
					class={select}
				>
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
			<h3 class="mt-6 text-sm text-zinc-300">Subtítulos</h3>
			<p class="text-xs text-zinc-500">
				Para los de texto: los de imagen (DVD, Blu-ray) se ven siempre como vienen, y los de estilo
				propio (ASS) conservan el suyo en el salón.
			</p>
			<SubtitleStylePanel style={subtitleStyle} onchange={chooseSubtitleStyle} />
			{#if styleProblem}
				<p class="mt-2 text-sm text-red-400">No se pudo guardar el estilo.</p>
			{/if}
			{#if data.intro !== null}
				<form
					method="post"
					action="?seccion={tab}&/intro"
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

		{#if data.keepHistory !== null}
			<section class={section}>
				<h2 class="mb-1 font-semibold">Lo que veo</h2>
				<form
					method="post"
					action="?seccion={tab}&/history"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
				>
					<label class="flex items-start gap-2 text-sm">
						<input
							type="checkbox"
							name="keepHistory"
							checked={data.keepHistory}
							onchange={(e) => e.currentTarget.form?.requestSubmit()}
							class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
						/>
						<span>
							Guardar lo que veo
							<span class="block text-xs text-zinc-500"
								>Qué series, películas y canales ves, cuánto rato y a qué horas{data.voice
									? ', para preguntárselo a la IA en Hablar («¿qué capítulo vi el viernes?»)'
									: ''}. Solo lo puedes consultar tú. Apagarlo no borra lo ya guardado.</span
							>
						</span>
					</label>
				</form>
				{#if data.recordTrips !== null}
					<form
						method="post"
						action="?seccion={tab}&/recordTrips"
						use:enhance={() =>
							async ({ update }) =>
								update({ reset: false })}
						class="mt-4"
					>
						<label class="flex items-start gap-2 text-sm">
							<input
								type="checkbox"
								name="recordTrips"
								checked={data.recordTrips}
								onchange={(e) => e.currentTarget.form?.requestSubmit()}
								class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
							/>
							<span>
								Guardar mis viajes
								<span class="block text-xs text-zinc-500"
									>Con el modo carretera abierto, por dónde vas: cada viaje con su recorrido,
									distancia y tiempo, y los km al mes. Solo los ves tú, en <a
										href="/viajes"
										class="text-amber-400 hover:underline">Viajes</a
									>, donde se borran. Apagarlo no borra lo ya guardado.</span
								>
							</span>
						</label>
					</form>
				{/if}
			</section>
		{/if}
	{/if}

	{#if tab === 'conexiones'}
		{#if data.langua}
			<section class={section}>
				<h2 class="mb-1 font-semibold">Langua</h2>
				<p class="mb-4 text-sm text-zinc-400">
					Tu app de idiomas. {data.voice
						? 'Desde Hablar se le manda el audio de lo que estás viendo, con su texto: «manda los últimos 5 minutos a Langua».'
						: 'Se le manda el audio de lo que estás viendo, con su texto.'} El token se crea en Langua,
					en Mi cuenta → Integraciones.
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
							<span class="text-sm text-amber-400">✓ Guardado</span>
						{:else if form && 'languaOk' in form}
							<span class="text-sm text-amber-400">✓ Langua acepta el token</span>
						{/if}
					</div>
				</form>
				{#if form && 'section' in form && form.section === 'langua'}
					<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
				{/if}
			</section>
		{/if}

		{#if data.musicApps}
			{@const apps = data.musicApps}
			<section class={section}>
				<h2 class="mb-1 font-semibold">Música en apps</h2>
				<p class="mb-4 text-sm text-zinc-400">
					Para escuchar tu música en apps que hablan Subsonic, como
					<a
						href="https://github.com/eddyizm/tempus"
						target="_blank"
						rel="noreferrer"
						class="text-amber-400 hover:underline">Tempus</a
					>, también en el coche con Android Auto. Con una contraseña solo para eso, aparte de la de
					tu cuenta.
				</p>
				<dl class="mb-4 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
					<dt class="text-zinc-400">Servidor</dt>
					<dd class="font-mono break-all">{apps.server}</dd>
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
						Generar otra deja sin acceso a las apps que usaban la anterior. Fuera de casa, el móvil
						necesita Tailscale conectado.
					</p>
				{/if}
			</section>
		{/if}
	{/if}

	{#if tab === 'aspecto'}
		<section class={section}>
			<h2 class="mb-1 font-semibold">Colores</h2>
			<p class="mb-4 text-sm text-zinc-400">
				Los de toda la app, en todas tus pantallas, también en la tele del salón.
			</p>
			<form
				method="post"
				action="?seccion={tab}&/theme"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
				class="grid gap-2 sm:grid-cols-2"
			>
				{#each THEMES as theme (theme.id)}
					{@const on = data.theme === theme.id}
					<button
						name="theme"
						value={theme.id}
						aria-pressed={on}
						class={[
							'flex items-center gap-3 rounded-md border p-2 text-left text-sm',
							on ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-800 hover:bg-zinc-900'
						]}
					>
						<!-- Its own colours, whatever theme is on now. -->
						<span class="flex shrink-0 overflow-hidden rounded border border-zinc-700">
							{#each themeSwatches(theme.id) as color, i (i)}
								<span class="h-6 w-3" style:background-color={color}></span>
							{/each}
						</span>
						<span class="flex-1">{theme.name}</span>
						{#if on}<span class="text-amber-400">✓</span>{/if}
					</button>
				{/each}
			</form>
			{#if form && 'section' in form && form.section === 'theme'}
				<p class="mt-2 text-sm text-red-400">{form.message}</p>
			{/if}
		</section>

		<section class={section}>
			<h2 class="mb-1 font-semibold">Al abrir la app</h2>
			<form
				method="post"
				action="?seccion={tab}&/openingQuote"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
			>
				<label class="flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						name="openingQuote"
						checked={data.openingQuoteOn}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
						class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
					/>
					<span>
						Una frase de tus series
						<span class="block text-xs text-zinc-500"
							>Unos segundos, en blanco sobre negro, como los rótulos de Frasier entre escenas. Sale
							de los subtítulos, mejor de la serie que estás viendo{data.ai?.keySource
								? ', y la IA elige las más ingeniosas'
								: ''}. Cualquier tecla o toque la quita.</span
						>
					</span>
				</label>
			</form>
		</section>

		<section class={section}>
			<h2 class="mb-1 font-semibold">Este dispositivo</h2>
			<p class="mb-4 text-sm text-zinc-400">
				Cómo se llama este navegador: al seguir con la música en otro («Sonaba en el salón») y en lo
				que ven los niños (Infantil: «está viendo… en la tablet»). Escríbelo con el artículo. Vacío,
				se dice la TV, el móvil o el ordenador.
			</p>
			<label for="deviceName" class="mb-1 block text-sm text-zinc-300">Nombre</label>
			<input
				id="deviceName"
				type="text"
				value={deviceName.value}
				oninput={(e) => deviceName.set(e.currentTarget.value)}
				maxlength={DEVICE_NAME_MAX}
				placeholder="el salón"
				autocomplete="off"
				class="w-full rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm sm:w-64"
			/>
			{#if mounted}
				<p class="mt-2 text-sm text-zinc-400">
					Se verá así: <span class="text-zinc-200">«Sonaba en {shownDeviceName(false)}»</span>
				</p>
			{/if}
		</section>

		{#if data.voice}
			<section class={section}>
				<h2 class="mb-1 font-semibold">Micrófono</h2>
				<p class="mb-4 text-sm text-zinc-400">
					Cómo se habla en este dispositivo, en Hablar, en el micrófono de arriba y con
					Ctrl+Mayús+Espacio. Solo aquí: la tablet de la cocina puede ir con toques y el móvil
					manteniendo pulsado.
				</p>
				<div class="flex flex-wrap gap-2">
					{#each [['hold', 'Mantener pulsado'], ['tap', 'Tocar para empezar y para enviar']] as const as [value, label] (value)}
						<button
							type="button"
							aria-pressed={mounted && micMode.value === value}
							onclick={() => micMode.set(value as MicMode)}
							class={[
								'rounded-full border px-3 py-1 text-sm',
								mounted && micMode.value === value
									? 'border-amber-500 text-amber-400'
									: 'border-zinc-700 hover:bg-zinc-900'
							]}>{label}</button
						>
					{/each}
				</div>
				<p class="mt-2 text-sm text-zinc-400">
					{#if mounted && micMode.tap}
						Un toque empieza a escuchar y otro lo envía; si se olvida, se envía solo a los 30
						segundos. Dos toques seguidos lo cancelan. El micrófono de arriba, mantenido, abre
						Hablar.
					{:else}
						Hablas mientras lo mantienes pulsado y se envía al soltar, como un audio de WhatsApp.
					{/if}
				</p>
			</section>
		{/if}

		{#if data.music}
			<section class={section}>
				<h2 class="mb-1 font-semibold">Calidad de la música</h2>
				<p class="mb-4 text-sm text-zinc-400">
					Solo en este dispositivo: el móvil puede ahorrar datos y la tele sonar como el CD. Se nota
					desde la siguiente canción.
				</p>
				<div class="flex flex-wrap gap-2">
					{#each [['original', 'Original'], ['saver', 'Ahorro (Opus)']] as const as [value, label] (value)}
						<button
							type="button"
							aria-pressed={mounted && musicQuality.value === value}
							onclick={() => musicQuality.set(value as MusicQuality)}
							class={[
								'rounded-full border px-3 py-1 text-sm',
								mounted && musicQuality.value === value
									? 'border-amber-500 text-amber-400'
									: 'border-zinc-700 hover:bg-zinc-900'
							]}>{label}</button
						>
					{/each}
				</div>
				<p class="mt-2 text-sm text-zinc-400">
					{#if mounted && musicQuality.value === 'saver'}
						Los CD en Opus: unas cinco veces menos datos y, al oído, igual; para escuchar con datos
						móviles. Los que aún no están comprimidos suenan en FLAC.
					{:else}
						Tal cual está en el disco: los CD en FLAC, sin pérdida (unos 25 MB por canción). Para
						casa. Lo que ya es Opus suena igual en los dos.
					{/if}
				</p>
			</section>

			<section class={section}>
				<h2 class="mb-1 font-semibold">Fondo de Música</h2>
				<p class="mb-4 text-sm text-zinc-400">
					Formas con los colores de la portada de lo que suena, detrás de las páginas de Música. Se
					mueven mientras suena. Solo en este dispositivo: la tele puede tener uno y el móvil
					ninguno.
				</p>
				<MusicBackgroundSettings />
			</section>
		{/if}
	{/if}

	{#if tab === 'casa'}
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
							<form method="post" action="?seccion={tab}&/deleteKey" use:enhance>
								<button class="text-red-400 hover:underline">Borrar</button>
							</form>
						</div>
					{/if}
					<form
						method="post"
						action="?seccion={tab}&/saveKey"
						use:enhance
						class="mb-4 flex flex-wrap gap-2"
					>
						<input
							type="password"
							name="key"
							autocomplete="new-password"
							placeholder={data.ai.keyHint ? 'Nueva clave' : 'sk-or-…'}
							aria-label="Clave de OpenRouter"
							class="{select} min-w-0 flex-1 font-mono"
						/>
						<button class={primary}>{data.ai.keyHint ? 'Cambiar' : 'Guardar'}</button>
					</form>
				{/if}

				{#snippet modelForm(
					use: 'films' | 'chat' | 'vision' | 'voice',
					label: string,
					value: string,
					fallback: string
				)}
					<form
						method="post"
						action="?seccion={tab}&/saveModel"
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
						{#if form && 'saved' in form && form.saved === { films: 'model', chat: 'chatModel', vision: 'visionModel', voice: 'voiceModel' }[use]}
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
					Vacío usa {data.ai.defaultVisionModel}. Mira fotogramas: mejor uno que vea bien las
					imágenes y no razone antes de responder (los que razonan, como GPT-5 u o3, cuestan mucho
					más aquí).
				</p>

				{#if data.ai.voice}
					<h3 class="mb-2 text-sm text-zinc-300">Modelo para la voz</h3>
					{@render modelForm(
						'voice',
						'Modelo para la voz',
						data.ai.voiceModel,
						data.ai.defaultVoiceModel
					)}
					<p class="mb-4 text-xs text-zinc-500">
						Vacío usa {data.ai.defaultVoiceModel}. Convierte lo que se dice en /voz en acciones:
						mejor uno rápido, porque se espera con el móvil en la mano, y que use bien las
						herramientas.
					</p>
				{/if}

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
					action="?seccion={tab}&/saveChatWeb"
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
								>Más completo y con enlaces a las fuentes, pero cuesta algo más por pregunta (unos
								0,7 céntimos de búsqueda, más el texto que lee).</span
							>
						</span>
					</label>
				</form>

				<form
					method="post"
					action="?seccion={tab}&/testAi"
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

		{#if data.labels}
			<section class={section}>
				<h2 class="mb-1 font-semibold">Etiquetas de los capítulos</h2>
				<p class="mb-4 text-sm text-zinc-400">
					Lo que el modelo de visión ({data.labels.model}, en Ollama) busca en los fotogramas al
					elegir «Etiquetar» en los capítulos seleccionados de una serie. Separadas por comas; luego
					se puede filtrar la serie por ellas. Solo tú ves esta sección.
				</p>
				<form
					method="post"
					action="?seccion={tab}&/saveEpisodeLabels"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
					class="flex flex-col gap-2"
				>
					<textarea
						name="labels"
						rows="3"
						value={data.labels.list}
						placeholder="perro, coche, cocina, playa"
						aria-label="Etiquetas de los capítulos"
						class="{select} w-full"></textarea>
					<div class="flex items-center gap-3">
						<button class={secondary}>Guardar</button>
						{#if form && 'saved' in form && form.saved === 'episodeLabels'}
							<span class="text-sm text-amber-400">✓</span>
						{/if}
					</div>
				</form>
				<p class="mt-1 text-xs text-zinc-500">
					Cambiarlas no toca lo ya etiquetado: etiqueta esos capítulos otra vez.
				</p>
			</section>
		{/if}

		{#if data.routes}
			<section class={section}>
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
						<span class="self-center text-sm text-amber-400">✓</span>
					{/if}
				</form>
				<p class="text-xs text-zinc-500">
					Vacía usa el suyo. Si te alojas uno propio (Docker), su dirección: las rutas salen de tu
					casa, sin cuotas (la búsqueda de sitios sigue necesitando el suyo).
				</p>
				{#if form && 'section' in form && form.section === 'routes'}
					<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
				{/if}
			</section>
		{/if}

		{#if data.relay}
			<section class={section}>
				<h2 class="mb-1 font-semibold">Compartir viajes</h2>
				<p class="mb-4 text-sm text-zinc-400">
					El modo carretera puede compartir el viaje con un enlace (para un grupo de WhatsApp, por
					ejemplo): quien lo abre ve el coche en el mapa mientras lo compartes. Pasa por un
					repetidor en un servidor público (<code>relay/</code> del repositorio), sin abrir la casa.
					Su dirección y la clave que espera (su <code>PUBLISH_KEY</code>). Solo tú ves esta
					sección.
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

		{#if data.kids}
			<section class={section}>
				<h2 class="mb-1 font-semibold">Cuentas infantiles</h2>
				<p class="mb-4 text-sm text-zinc-400">
					Solo ven las series y películas con la etiqueta «infantil», y no pueden gestionar nada ni
					hablar con la IA. Se crean aquí, y la propia cuenta no puede dejar de ser infantil. Solo
					tú ves esta sección.
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
					action="?seccion={tab}&/createKid"
					use:enhance
					class="grid gap-2 sm:grid-cols-2"
				>
					<!-- Two rows: three fields and the button in one overflowed the section. -->
					<input
						name="name"
						required
						placeholder="Nombre"
						aria-label="Nombre"
						class="{select} min-w-0"
					/>
					<input
						name="email"
						type="email"
						required
						autocomplete="off"
						placeholder="lucia@casa.local"
						aria-label="Email para entrar"
						class="{select} min-w-0"
					/>
					<input
						name="password"
						type="password"
						required
						minlength="8"
						autocomplete="new-password"
						placeholder="Contraseña"
						aria-label="Contraseña"
						class="{select} min-w-0"
					/>
					<button class="{primary} justify-self-start">Crear</button>
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
			{#if justUpdated}
				<p
					class="mb-3 rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-300"
					role="status"
				>
					✓ Actualizado de la {justUpdated.from} a la {justUpdated.to}.
				</p>
			{/if}
			<p class="text-sm text-zinc-400">
				{#if data.version.release}
					Tienes la {data.version.current}.
				{:else}
					Versión de pruebas ({data.version.current.slice(0, 11)}): se actualiza con cada cambio,
					sin versiones numeradas.
				{/if}
			</p>
			{#if data.version.update}
				{@const update = data.version.update}
				<div class="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
					<p class="font-medium text-amber-300">Hay una versión nueva: la {update.version}</p>
					{#if update.notesHtml}
						<!-- The release's Markdown as GitHub makes it HTML (updates.ts); its links, apart. -->
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<div
							class="release-notes mt-2 max-h-80 overflow-y-auto text-sm text-zinc-300"
							onclick={(e) => {
								const link = (e.target as HTMLElement).closest('a');
								if (!link?.href) return;
								e.preventDefault();
								window.open(link.href, '_blank', 'noreferrer');
							}}
						>
							{@html update.notesHtml}
						</div>
					{/if}
					<a
						href={update.url}
						target="_blank"
						rel="noreferrer"
						class="mt-2 inline-block text-sm text-amber-400 hover:underline">Ver en GitHub</a
					>
					{#if updating}
						<p class="mt-3 text-sm">Actualizando…</p>
						<UpdateProgress current={data.version.current} target={update.version} />
					{:else if data.version.canUpdate}
						<form
							method="post"
							action="?seccion={tab}&/update"
							use:enhance
							class="mt-3 flex flex-wrap items-center gap-3"
						>
							<button class={primary}>Actualizar ahora</button>
							<span class="text-xs text-zinc-400"
								>Antes se hace una copia de la base de datos. Si no, se instalará sola esta
								madrugada.</span
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
	{/if}

	{#if tab === 'cuenta'}
		<section class={section}>
			<h2 class="mb-3 font-semibold">Cuenta</h2>
			<form
				method="post"
				action="/logout"
				class="flex flex-wrap items-center justify-between gap-3"
			>
				<p class="text-sm">
					{data.account.name} · <span class="text-zinc-400">{data.account.email}</span>
				</p>
				<button class={secondary}>Salir</button>
			</form>
		</section>
		{#if data.twoFactor}
			{@const tf = data.twoFactor}
			<section class={section}>
				<h2 class="mb-1 font-semibold">Verificación en dos pasos</h2>
				{#if !tf.enabled}
					<p class="mb-3 text-sm text-zinc-400">
						Tras la contraseña, un código de una app en tu móvil (Proton Pass, Google
						Authenticator…): aunque alguien sepa tu contraseña, sin el móvil no entra.
					</p>
					<a href="/verificacion" class={primary}>Activar</a>
				{:else}
					<p class="mb-3 text-sm text-zinc-400">
						Activada{tf.required ? ': el administrador siempre la lleva' : ''}. Quedan
						{tf.codesLeft === 1 ? '1 código' : `${tf.codesLeft} códigos`} de recuperación.
					</p>
					{#if form && 'backupCodes' in form && form.backupCodes}
						<div class="mb-3 rounded-md border border-amber-500/40 p-3 text-sm">
							<p class="mb-2">
								Tus nuevos códigos de recuperación; los de antes ya no valen. Guárdalos fuera del
								móvil: no se vuelven a mostrar.
							</p>
							<ul class="grid grid-cols-2 gap-1 rounded bg-zinc-900 p-2 font-mono">
								{#each form.backupCodes as code (code)}
									<li>{code}</li>
								{/each}
							</ul>
						</div>
					{/if}
					<form method="post" action="?seccion={tab}&/newBackupCodes" use:enhance class="space-y-2">
						<label class="block text-sm">
							Tu contraseña, para cambiar algo de esto
							<PasswordInput
								name="password"
								required
								autocomplete="current-password"
								box="mt-1"
								class="{select} w-full"
							/>
						</label>
						<div class="flex flex-wrap gap-2">
							<button class={secondary}>Nuevos códigos de recuperación</button>
							{#if !tf.required}
								<button class={secondary} formaction="?seccion={tab}&/disableTwoFactor"
									>Desactivar</button
								>
							{/if}
						</div>
					</form>
				{/if}
				{#if form && 'twoFactorProblem' in form}
					<p class="mt-2 text-sm text-red-400">{form.twoFactorProblem}</p>
				{/if}
			</section>
		{/if}
	{/if}
</div>

<style>
	/* A release's notes, as GitHub writes them in HTML: headings, lists, bold and links. */
	.release-notes :global(:is(h1, h2, h3, h4)) {
		margin: 0.9em 0 0.3em;
		font-weight: 600;
		color: var(--color-zinc-100);
	}
	.release-notes :global(h2) {
		font-size: 1.05em;
	}
	.release-notes :global(:is(h1, h2, h3, h4):first-child) {
		margin-top: 0;
	}
	.release-notes :global(:is(p, ul, ol)) {
		margin: 0.4em 0;
	}
	.release-notes :global(ul) {
		list-style: disc;
		padding-left: 1.25em;
	}
	.release-notes :global(ol) {
		list-style: decimal;
		padding-left: 1.25em;
	}
	.release-notes :global(li + li) {
		margin-top: 0.25em;
	}
	.release-notes :global(strong) {
		color: var(--color-zinc-100);
	}
	.release-notes :global(a) {
		color: var(--color-amber-400);
	}
	.release-notes :global(a:hover) {
		text-decoration: underline;
	}
	.release-notes :global(code) {
		border-radius: 0.25em;
		background: var(--color-zinc-800);
		padding: 0 0.3em;
	}
</style>

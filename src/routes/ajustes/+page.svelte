<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { DEVICE_NAME_MAX, deviceName, shownDeviceName } from '#lib/device-name.svelte.ts';
	import { musicQuality, type MusicQuality } from '#lib/music-quality.svelte.ts';
	import MusicBackgroundSettings from '#lib/components/MusicBackgroundSettings.svelte';
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
	{/if}
</div>

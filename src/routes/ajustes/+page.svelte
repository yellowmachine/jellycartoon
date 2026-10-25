<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { DEVICE_NAME_MAX, deviceName, shownDeviceName } from '#lib/device-name.svelte.ts';
	import { micMode, type MicMode } from '#lib/mic-mode.svelte.ts';
	import { wakeWord } from '#lib/wake-word.svelte.ts';
	import { musicQuality, type MusicQuality } from '#lib/music-quality.svelte.ts';
	import MusicBackgroundSettings from '#lib/components/MusicBackgroundSettings.svelte';
	import PasswordInput from '#lib/components/PasswordInput.svelte';
	import PushNotices from '#lib/components/PushNotices.svelte';
	import SubtitleStylePanel from '#lib/components/SubtitleStylePanel.svelte';
	import type { SubtitleStyle } from '#lib/subtitle-style.ts';
	import UpdateProgress from '#lib/components/UpdateProgress.svelte';
	import { languageLabel } from '#lib/languages.ts';
	import { THEMES, themeSwatches } from '#lib/themes.ts';
	import { AVATARS, avatar } from '#lib/avatars.ts';
	import SettingsSearch from '#lib/components/SettingsSearch.svelte';
	import { ANSWER_SECONDS, ASK_EVERY_OPTIONS } from '#lib/still-there.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** «¿Sigues ahí?» (#77), as a child's in /infantil. */
	const ASK: { value: number | null; label: string }[] = [
		{ value: null, label: 'Nunca' },
		...ASK_EVERY_OPTIONS.map((n) => ({ value: n, label: `Cada ${n} capítulos` }))
	];

	let testing = $state(false);

	/** Until when an adult's link works (#157): «el lunes 26 a las 12:00». */
	const until = (date: Date) =>
		`el ${date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' })} a las ${date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
	const initialOf = (name: string) => [...name.trim()][0]?.toLocaleUpperCase('es') ?? '?';
	/** The link, to paste in WhatsApp. */
	let copied = $state(false);
	async function copyLink(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Without the clipboard (http, an old browser): the field is selected on focus, to copy by hand.
		}
	}
	/** A new child enters with permission by default: no email nor password to make up. */
	let newKidByApproval = $state(true);

	/** «Actualizar ahora» sent and not answered yet. */
	let askingUpdate = $state(false);
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
	/** OpenRouter's balance: e.g. `7,40 $`. */
	const dollars = (n: number) =>
		n.toLocaleString('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
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

	<!-- What is in any tab, by a word (settings-index.ts): the page only draws the open one. -->
	<SettingsSearch
		shown={{
			kid: Boolean(data.kid),
			intro: data.intro,
			keepHistory: data.keepHistory,
			recordTrips: data.recordTrips,
			langua: data.langua,
			musicApps: data.musicApps,
			voice: Boolean(data.voice),
			music: Boolean(data.music),
			ai: data.ai,
			labels: data.labels,
			routes: data.routes,
			relay: data.relay,
			kids: data.kids,
			twoFactor: data.twoFactor
		}}
	/>

	<!-- The drawings to choose from (#141, #157): a child's, an adult's, one's own. -->
	{#snippet avatarPicker(chosen: string | null, label: string)}
		<div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
			{#each AVATARS as a (a.id)}
				<label class="cursor-pointer rounded-full ring-amber-400 has-checked:ring-2" title={a.id}>
					<input
						type="radio"
						name="avatar"
						value={a.id}
						checked={a.id === chosen}
						class="sr-only"
					/>
					<span class="flex h-9 w-9 items-center justify-center rounded-full text-xl {a.color}"
						>{a.emoji}</span
					>
				</label>
			{/each}
		</div>
	{/snippet}

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
		<section class={section} id="reproduccion">
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
			<h3 id="estilo-subtitulos" class="mt-6 text-sm text-zinc-300">Subtítulos</h3>
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
					id="cortinilla"
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
			{#if data.stillThere}
				<!-- #77: with «siguiente automático», for who falls asleep with the series. -->
				<form
					id="sigues-ahi"
					method="post"
					action="?seccion={tab}&/askEvery"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
					class="mt-4 text-sm"
				>
					<div class="flex flex-wrap items-center gap-2">
						<span class="mr-1">Preguntar «¿Sigues ahí?»</span>
						{#each ASK as option (option.value)}
							<button
								name="askEvery"
								value={option.value ?? ''}
								aria-pressed={data.stillThere.every === option.value}
								class={[
									'rounded-full border px-3 py-1',
									data.stillThere.every === option.value
										? 'border-amber-500 text-amber-400'
										: 'border-zinc-700 hover:bg-zinc-900'
								]}>{option.label}</button
							>
						{/each}
					</div>
					<p class="mt-1 text-xs text-zinc-500">
						Con «siguiente automático», tras esos capítulos seguidos sin tocar nada el siguiente
						espera a que contestes; si en {ANSWER_SECONDS / 60} minutos nadie lo hace, se para. Para cuando
						te duermes con la serie. En el navegador y en el salón.
					</p>
				</form>
			{/if}
		</section>

		{#if data.keepHistory !== null}
			<section class={section} id="lo-que-veo">
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
						id="guardar-viajes"
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
			<section class={section} id="langua">
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
			<section class={section} id="musica-en-apps">
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
		<section class={section} id="colores">
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

		<section class={section} id="al-abrir">
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

		<section class={section} id="este-dispositivo">
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
			<!-- #144, phase 1: trying wake words on this phone or tablet. -->
			{#if !data.kid}
				<p class="mt-4 border-t border-zinc-800 pt-4 text-sm">
					<a href="/activacion" class="text-amber-400 hover:underline"
						>Probar la palabra de activación</a
					>
					<span class="text-zinc-400"
						>: «hola casita», «hey luna», «candy candy» o «Jelly Cartoon», sin pulsar el micrófono.</span
					>
				</p>
			{/if}
			<!-- The adults' notices with the app closed: the fridge (#131), and a child asking to enter
			     (#141) for whoever lets one in. -->
			{#if !data.kid}
				<PushNotices guardian={Boolean(page.data.guardian)} />
			{/if}
		</section>

		{#if data.voice}
			<section class={section} id="microfono">
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
				<!-- #144, phase 2: the wake word, only on this device. -->
				<label class="mt-4 flex items-center gap-3 border-t border-zinc-800 pt-4 text-sm">
					<input
						type="checkbox"
						checked={mounted && wakeWord.on}
						onchange={(e) => wakeWord.set(e.currentTarget.checked)}
						class="rounded border-zinc-600 bg-zinc-900 text-amber-500"
					/>
					Activar la voz diciendo «hola casita»
				</label>
				<p class="mt-2 text-sm text-zinc-400">
					Sin pulsar nada: suena un pitido, dices lo que quieres y se envía cuando te callas.
					Escucha mientras la app está abierta y delante, con la pantalla encendida; al abrir la app
					hay que tocar la pantalla una vez. Nada sale del dispositivo hasta que oye «hola casita».
				</p>
				{#if mounted && wakeWord.on}
					<p class={['mt-2 text-sm', wakeWord.problem ? 'text-red-400' : 'text-zinc-300']}>
						{wakeWord.problem ??
							{
								off: 'Parada.',
								loading: 'Preparando (unos 9 MB la primera vez)…',
								on: 'Escuchando «hola casita».',
								tap: 'Toca la pantalla para que empiece a escuchar.'
							}[wakeWord.status]}
					</p>
				{/if}
			</section>
		{/if}

		{#if data.music}
			<section class={section} id="calidad-musica">
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

			<section class={section} id="modo-dj">
				<h2 class="mb-1 font-semibold">Modo DJ</h2>
				<p class="mb-4 text-sm text-zinc-400">
					Cuándo habla el locutor. Mezclada, como en la radio: entra al final de una canción con la
					música más baja, y la siguiente empieza por debajo de su voz. De momento solo en el
					navegador; en los altavoces de casa sigue hablando entre canciones.
				</p>
				<form
					method="post"
					action="?seccion={tab}&/djMix"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
					class="flex flex-wrap gap-2"
				>
					{#each [['between', 'Entre canciones'], ['mix', 'Mezclada con las canciones']] as const as [value, label] (value)}
						<button
							name="djMix"
							{value}
							aria-pressed={data.djMix === (value === 'mix')}
							class={[
								'rounded-full border px-3 py-1 text-sm',
								data.djMix === (value === 'mix')
									? 'border-amber-500 text-amber-400'
									: 'border-zinc-700 hover:bg-zinc-900'
							]}>{label}</button
						>
					{/each}
				</form>
			</section>

			<section class={section} id="fondo-musica">
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
			<section class={section} id="ia">
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
				{#if data.ai.connected}
					<p
						class={['mb-3 text-sm', data.ai.connected === 'ok' ? 'text-amber-400' : 'text-red-400']}
					>
						{{
							ok: '✓ Conectado con OpenRouter: la app ya tiene su clave.',
							cancelado: 'No se ha conectado: se canceló en OpenRouter.',
							caducado:
								'No se ha conectado: tardó demasiado o se empezó en otro navegador. Prueba otra vez.'
						}[data.ai.connected] ?? 'No se ha podido conectar con OpenRouter. Prueba otra vez.'}
					</p>
				{/if}
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
					<!-- Off to OpenRouter and back (OAuth): not enhanced, the browser goes there itself. -->
					<form method="post" action="?seccion={tab}&/connectOpenRouter" class="mb-2">
						<button class={data.ai.keyHint ? secondary : primary}
							>{data.ai.keyHint
								? 'Volver a conectar con OpenRouter'
								: 'Conectar con OpenRouter'}</button
						>
					</form>
					<p class="mb-3 text-xs text-zinc-500">
						Entras en OpenRouter (o te creas la cuenta), lo autorizas y vuelves aquí con la clave
						hecha. Lo que se use se paga con el crédito de esa cuenta.
					</p>
					<details class="mb-4 text-sm">
						<summary class="cursor-pointer text-zinc-400 hover:text-white">
							O pega una clave a mano
						</summary>
						<form
							method="post"
							action="?seccion={tab}&/saveKey"
							use:enhance
							class="mt-2 flex flex-wrap gap-2"
						>
							<input
								type="password"
								name="key"
								autocomplete="new-password"
								placeholder={data.ai.keyHint ? 'Nueva clave' : 'sk-or-…'}
								aria-label="Clave de OpenRouter"
								class="{select} min-w-0 flex-1 font-mono"
							/>
							<button class={secondary}>{data.ai.keyHint ? 'Cambiar' : 'Guardar'}</button>
						</form>
					</details>
				{/if}

				{#if data.ai.keyHint}
					<h3 class="mb-2 text-sm text-zinc-300">Crédito y gasto</h3>
					<div class="mb-4 text-sm">
						{#await data.ai.balance}
							<span class="text-zinc-500">Consultando…</span>
						{:then balance}
							{#if !balance}
								<span class="text-zinc-500">No se pudo consultar.</span>
							{:else}
								{#if balance.creditOutAt}
									<p class="mb-2 text-red-400">
										Se acabó el crédito ({balance.creditOutAt.toLocaleString('es-ES', {
											dateStyle: 'short',
											timeStyle: 'short'
										})}): lo que usa la IA no funciona hasta que lo recargues en
										<a
											href="https://openrouter.ai/settings/credits"
											class="underline"
											target="_blank"
											rel="noreferrer">openrouter.ai</a
										>.
									</p>
								{/if}
								{#if balance.credits}
									<p class="mb-1">
										Quedan <b>{dollars(balance.credits.left)}</b> en la cuenta
										<span class="text-zinc-400">
											· comprados {dollars(balance.credits.bought)}, gastados {dollars(
												balance.credits.used
											)}</span
										>
									</p>
								{:else if balance.creditsProblem}
									<p class="mb-1 text-red-400">Clave de gestión: {balance.creditsProblem}</p>
								{/if}
								{#if balance.left !== null}
									<p class="mb-1">
										Límite de esta clave: quedan {dollars(balance.left)} de {dollars(
											balance.limit!
										)}
									</p>
								{/if}
								<p class="text-zinc-400">
									Esta clave ha gastado hoy {dollars(balance.spent.day)} · esta semana {dollars(
										balance.spent.week
									)} · este mes {dollars(balance.spent.month)} · en total {dollars(
										balance.spent.total
									)}
								</p>
								{#if !balance.credits}
									<p class="mt-1 text-xs text-zinc-500">
										Lo que te queda en la cuenta se ve en
										<a
											href="https://openrouter.ai/settings/credits"
											class="hover:underline"
											target="_blank"
											rel="noreferrer">openrouter.ai/settings/credits</a
										>.
									</p>
								{/if}
							{/if}
						{/await}
					</div>

					<!-- Optional: OpenRouter only tells the account's credit to a management key. -->
					<details class="mb-4 text-sm">
						<summary class="cursor-pointer text-zinc-400 hover:text-white">
							Ver aquí el crédito que queda (opcional)
						</summary>
						<p class="mt-2 mb-2 text-xs text-zinc-500">
							OpenRouter solo dice el crédito de la cuenta a una «clave de gestión», que se crea a
							mano en
							<a
								href="https://openrouter.ai/settings/management-keys"
								class="hover:underline"
								target="_blank"
								rel="noreferrer">openrouter.ai/settings/management-keys</a
							>. Solo sirve para eso: no se usa para la IA. Se guarda cifrada.
						</p>
						{#if data.ai.hasManagementKey}
							<form
								method="post"
								action="?seccion={tab}&/deleteManagementKey"
								use:enhance
								class="flex items-center gap-3"
							>
								<span>Clave de gestión guardada</span>
								<button class="text-red-400 hover:underline">Borrar</button>
							</form>
						{:else}
							<form
								method="post"
								action="?seccion={tab}&/saveManagementKey"
								use:enhance
								class="flex flex-wrap gap-2"
							>
								<input
									type="password"
									name="key"
									autocomplete="new-password"
									placeholder="sk-or-…"
									aria-label="Clave de gestión de OpenRouter"
									class="{select} min-w-0 flex-1 font-mono"
								/>
								<button class={secondary}>Guardar</button>
							</form>
						{/if}
					</details>
				{/if}

				{#snippet modelForm(
					use: 'films' | 'chat' | 'vision' | 'voice' | 'homework',
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
						{#if form && 'saved' in form && form.saved === { films: 'model', chat: 'chatModel', vision: 'visionModel', voice: 'voiceModel', homework: 'homeworkModel' }[use]}
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

				<h3 class="mb-2 text-sm text-zinc-300">Modelo para los deberes</h3>
				{@render modelForm(
					'homework',
					'Modelo para los deberes',
					data.ai.homeworkModel,
					data.ai.defaultHomeworkModel
				)}
				<p class="mb-4 text-xs text-zinc-500">
					Vacío usa {data.ai.defaultHomeworkModel}. Prepara los ejercicios de los peques desde los
					subtítulos de lo que han visto: el mejor, aunque cueste algo más (unos céntimos cada
					deber).
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
			<section class={section} id="etiquetas">
				<h2 class="mb-1 font-semibold">Etiquetas de los capítulos</h2>
				<p class="mb-4 text-sm text-zinc-400">
					Conjuntos de etiquetas que el modelo de visión ({data.labels.model}, en Ollama) busca en
					los fotogramas: al seleccionar capítulos en una serie, «Etiquetar con» uno de ellos. Luego
					se puede filtrar la serie por lo que vio, y el avance está en Gestión → Etiquetado. Solo
					tú ves esta sección.
				</p>
				{#snippet labelSetForm(set: { id?: number; name: string; labels: string[] } | null)}
					<form
						method="post"
						action="?seccion={tab}&/saveLabelSet"
						use:enhance={() =>
							async ({ update }) =>
								update({ reset: !set })}
						class="flex flex-col gap-2"
					>
						{#if set?.id}<input type="hidden" name="id" value={set.id} />{/if}
						<input
							name="name"
							required
							maxlength="40"
							value={set?.name ?? ''}
							placeholder="Animales"
							aria-label="Nombre del conjunto"
							class="{select} min-w-0"
						/>
						<textarea
							name="labels"
							rows="2"
							required
							value={set?.labels.join(', ') ?? ''}
							placeholder="perro, gato, caballo, pájaro"
							aria-label="Etiquetas, separadas por comas"
							class="{select} w-full"></textarea>
						<div class="flex items-center gap-3">
							<button class={secondary}>{set ? 'Guardar' : 'Crear conjunto'}</button>
							{#if set?.id}
								<button
									formaction="?seccion={tab}&/deleteLabelSet"
									formnovalidate
									class="text-sm text-red-400 hover:underline">Borrar</button
								>
							{/if}
						</div>
					</form>
				{/snippet}
				{#if data.labels.sets.length}
					<ul class="mb-4 divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
						{#each data.labels.sets as set (set.id)}
							<li>
								<details>
									<summary class="flex cursor-pointer items-center gap-3 p-2">
										<span class="shrink-0 font-medium">{set.name}</span>
										<span class="min-w-0 flex-1 truncate text-zinc-400"
											>{set.labels.join(', ')}</span
										>
									</summary>
									<div class="border-t border-zinc-800 p-3">{@render labelSetForm(set)}</div>
								</details>
							</li>
						{/each}
					</ul>
				{/if}
				<h3 class="mb-2 text-sm text-zinc-300">Nuevo conjunto</h3>
				{@render labelSetForm(null)}
				<p class="mt-2 text-xs text-zinc-500">
					Cambiar un conjunto no toca lo ya etiquetado: etiqueta esos capítulos otra vez. Borrarlo
					quita también lo que vio con él.
				</p>
				{#if form && 'section' in form && form.section === 'labels'}
					<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
				{:else if form && 'saved' in form && form.saved === 'labelSet'}
					<p class="mt-3 text-sm text-amber-400">✓ Guardado</p>
				{/if}
			</section>
		{/if}

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
			<section class={section} id="compartir-viajes">
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

		{#if data.kids && data.people}
			<section class={section} id="personas">
				<h2 class="mb-1 font-semibold">Personas de la casa</h2>
				<p class="mb-4 text-sm text-zinc-400">
					Tú creas las cuentas de todos, adultos y peques. Solo tú ves esta sección.
				</p>

				{#snippet guardians(kidId: string | null, chosen: string[])}
					<fieldset class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
						<legend class="mb-1 text-zinc-400">Le dejan entrar (sus padres o tutores)</legend>
						{#each data.kids!.adults as adult (adult.id)}
							<label class="flex items-center gap-1.5">
								<input
									type="checkbox"
									name="guardian"
									value={adult.id}
									checked={chosen.includes(adult.id)}
									class="rounded border-zinc-600 bg-zinc-900 text-amber-500"
								/>
								{adult.name}
							</label>
						{/each}
					</fieldset>
					{#if !chosen.length && kidId}
						<p class="text-xs text-zinc-500">Sin ninguno, te lo pide a ti.</p>
					{/if}
				{/snippet}

				{#if form && 'invited' in form && form.invited}
					{@const invited = form.invited}
					<!-- Shown once: the token is only in the link, the server keeps its hash. -->
					<div class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
						<p class="mb-2 font-medium text-amber-300">El enlace de {invited.name}</p>
						<div class="flex flex-wrap items-start gap-4">
							<div class="w-44 shrink-0 rounded bg-white p-1" aria-label="Código QR del enlace">
								{@html invited.qr}
							</div>
							<div class="min-w-0 flex-1 space-y-2">
								<p>
									Que apunte la cámara de su móvil al código, o mándale el enlace por WhatsApp. Ahí
									elige su contraseña y entra.
								</p>
								<p class="text-zinc-400">
									Vale una vez, hasta {until(invited.until)}. Solo funciona en la wifi de casa o con
									WireGuard encendido.
								</p>
								<div class="flex flex-wrap gap-2">
									<input
										readonly
										value={invited.url}
										aria-label="Enlace"
										class="{select} min-w-0 flex-1 font-mono text-xs"
										onfocus={(e) => e.currentTarget.select()}
									/>
									<button type="button" class={secondary} onclick={() => copyLink(invited.url)}
										>{copied ? '✓ Copiado' : 'Copiar'}</button
									>
								</div>
							</div>
						</div>
					</div>
				{/if}

				<h3 class="mb-2 text-sm text-zinc-300">Adultos</h3>
				<ul class="mb-4 divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
					{#each data.people.adults as adult (adult.id)}
						{@const a = adult.avatar ? avatar(adult.avatar) : null}
						<li>
							<details>
								<summary class="flex cursor-pointer items-center gap-3 p-2">
									<span
										class={[
											'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
											a ? `text-lg ${a.color}` : 'bg-amber-500 font-semibold text-zinc-950'
										]}>{a ? a.emoji : initialOf(adult.name)}</span
									>
									<span class="min-w-0 flex-1 truncate"
										>{adult.name} <span class="text-zinc-500">· {adult.email}</span></span
									>
									<span class="shrink-0 text-xs text-zinc-400"
										>{adult.admin
											? 'Administrador'
											: adult.hasPassword
												? ''
												: adult.linkUntil
													? `Sin entrar: su enlace vale hasta ${until(adult.linkUntil)}`
													: 'Sin entrar: su enlace caducó'}</span
									>
								</summary>
								<div class="flex flex-col gap-3 border-t border-zinc-800 p-3">
									<form
										method="post"
										action="?seccion={tab}&/saveAdult"
										use:enhance={() =>
											async ({ update }) =>
												update({ reset: false })}
										class="flex flex-col gap-3"
									>
										<input type="hidden" name="userId" value={adult.id} />
										{@render avatarPicker(adult.avatar, `Dibujo de ${adult.name}`)}
										<button class="{primary} self-start">Guardar</button>
									</form>
									{#if !adult.admin}
										<form
											method="post"
											action="?seccion={tab}&/newLink"
											use:enhance
											class="flex flex-wrap items-center gap-3"
										>
											<input type="hidden" name="userId" value={adult.id} />
											<button class={secondary}>Nuevo enlace para entrar</button>
											<span class="text-xs text-zinc-500"
												>{adult.hasPassword
													? 'Si ha olvidado su contraseña: con él elige otra.'
													: 'El anterior deja de valer.'}</span
											>
										</form>
									{/if}
								</div>
							</details>
						</li>
					{/each}
				</ul>

				<h3 class="mb-2 text-sm text-zinc-300">Nuevo adulto</h3>
				<form
					method="post"
					action="?seccion={tab}&/createAdult"
					use:enhance
					class="mb-6 flex flex-col gap-3"
				>
					<div class="grid gap-2 sm:grid-cols-2">
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
							placeholder="ana@ejemplo.com"
							aria-label="Email"
							class="{select} min-w-0"
						/>
					</div>
					{@render avatarPicker(AVATARS[0].id, 'Dibujo del adulto nuevo')}
					<p class="text-xs text-zinc-500">
						Sin contraseña: la app te da un enlace y un QR para que la elija. El email es para
						entrar; no se le manda nada.
					</p>
					<button class="{primary} self-start">Añadir</button>
				</form>

				<h3 id="cuentas-infantiles" class="mb-1 text-sm text-zinc-300">Peques</h3>
				<p class="mb-3 text-xs text-zinc-500">
					Solo ven las series y películas con la etiqueta «infantil», y no pueden gestionar nada ni
					hablar con la IA. Los más pequeños entran sin contraseña: en un dispositivo de la casa
					eligen su dibujo, y uno de sus padres o tutores les deja entrar desde el móvil.
				</p>

				{#if data.kids.accounts.length}
					<ul class="mb-6 divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
						{#each data.kids.accounts as kid (kid.id)}
							{@const a = avatar(kid.avatar)}
							<li>
								<details>
									<summary class="flex cursor-pointer items-center gap-3 p-2">
										<span
											class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg {a.color}"
											>{a.emoji}</span
										>
										<span class="min-w-0 flex-1 truncate">{kid.name}</span>
										<span class="shrink-0 text-xs text-zinc-400"
											>{kid.byApproval ? 'Entra con permiso' : 'Con contraseña'}</span
										>
									</summary>
									<form
										method="post"
										action="?seccion={tab}&/saveKid"
										use:enhance={() =>
											async ({ update }) =>
												update({ reset: false })}
										class="flex flex-col gap-3 border-t border-zinc-800 p-3"
									>
										<input type="hidden" name="kidId" value={kid.id} />
										{@render avatarPicker(kid.avatar, `Dibujo de ${kid.name}`)}
										<label class="flex items-center gap-2">
											<input
												type="checkbox"
												name="byApproval"
												checked={kid.byApproval}
												class="rounded border-zinc-600 bg-zinc-900 text-amber-500"
											/>
											Entra con permiso, sin contraseña
										</label>
										{@render guardians(kid.id, kid.guardians)}
										<input
											name="password"
											type="password"
											minlength="8"
											autocomplete="new-password"
											placeholder={kid.byApproval
												? 'Contraseña, si deja de entrar con permiso'
												: 'Nueva contraseña (vacía, la de siempre)'}
											aria-label="Contraseña"
											class="{select} min-w-0"
										/>
										<button class="{primary} self-start">Guardar</button>
									</form>
								</details>
							</li>
						{/each}
					</ul>
				{/if}

				<h3 class="mb-2 text-sm text-zinc-300">Nuevo peque</h3>
				<form
					method="post"
					action="?seccion={tab}&/createKid"
					use:enhance
					class="flex flex-col gap-3"
				>
					<input
						name="name"
						required
						placeholder="Nombre"
						aria-label="Nombre"
						class="{select} min-w-0"
					/>
					{@render avatarPicker(AVATARS[0].id, 'Dibujo del peque nuevo')}
					<label class="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							name="byApproval"
							bind:checked={newKidByApproval}
							class="rounded border-zinc-600 bg-zinc-900 text-amber-500"
						/>
						Entra con permiso, sin contraseña
					</label>
					{#if newKidByApproval}
						{@render guardians(null, [])}
					{:else}
						<div class="grid gap-2 sm:grid-cols-2">
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
						</div>
						<p class="text-xs text-zinc-500">
							El email solo sirve para entrar: no hace falta que exista.
						</p>
					{/if}
					<button class="{primary} self-start">Crear</button>
				</form>

				<h3 id="dispositivos-casa" class="mt-6 mb-1 text-sm text-zinc-300">
					Dispositivos de la casa
				</h3>
				<p class="mb-2 text-xs text-zinc-500">
					Solo en ellos, cuando nadie ha entrado, se ve «¿Quién eres?» con los dibujos de los peques
					y de los adultos: un adulto entra diciendo que sí desde su móvil.
				</p>
				{#if data.kids.devices.length}
					<ul class="mb-3 divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
						{#each data.kids.devices as device (device.id)}
							<li class="flex items-center gap-3 p-2">
								<span class="min-w-0 flex-1 truncate"
									>{device.name}{#if device.id === data.kids.here}
										<span class="text-amber-400"> · este</span>{/if}</span
								>
								<form method="post" action="?seccion={tab}&/forgetDevice" use:enhance>
									<input type="hidden" name="id" value={device.id} />
									<button class="text-red-400 hover:underline">Quitar</button>
								</form>
							</li>
						{/each}
					</ul>
				{/if}
				{#if !data.kids.here}
					<form
						method="post"
						action="?seccion={tab}&/trustDevice"
						use:enhance
						class="flex flex-wrap gap-2"
					>
						<input
							name="name"
							required
							maxlength="60"
							placeholder="la TV del salón"
							aria-label="Nombre de este dispositivo"
							class="{select} min-w-0 flex-1"
						/>
						<button class={secondary}>Este dispositivo es de la casa</button>
					</form>
				{/if}

				{#if form && 'section' in form && (form.section === 'kids' || form.section === 'people')}
					<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
				{:else if form && 'saved' in form && form.saved === 'adult'}
					<p class="mt-3 text-sm text-amber-400">✓ Guardado</p>
				{:else if form && 'saved' in form && form.saved === 'kids'}
					<p class="mt-3 text-sm text-amber-400">✓ Cuenta creada</p>
				{:else if form && 'saved' in form && form.saved === 'kid'}
					<p class="mt-3 text-sm text-amber-400">✓ Guardado</p>
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
						<!-- Once: pressed again while it is asked, WUD got it twice and one failed. -->
						<form
							method="post"
							action="?seccion={tab}&/update"
							use:enhance={() => {
								askingUpdate = true;
								return async ({ update }) => {
									await update();
									askingUpdate = false;
								};
							}}
							class="mt-3 flex flex-wrap items-center gap-3"
						>
							<button class={primary} disabled={askingUpdate}
								>{askingUpdate ? 'Pidiendo la actualización…' : 'Actualizar ahora'}</button
							>
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
		{#if page.url.searchParams.has('bienvenida')}
			<p
				class="mb-6 rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-300"
				role="status"
			>
				✓ Ya estás dentro. Aquí puedes elegir tu dibujo y, mejor aún, activar la verificación en dos
				pasos: aunque alguien supiera tu contraseña, sin tu móvil no entraría.
			</p>
		{/if}
		<section class={section} id="cuenta">
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
			{#if data.account.avatar !== undefined}
				<form
					method="post"
					action="?seccion={tab}&/myAvatar"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
					class="mt-4 flex flex-col gap-3"
				>
					<p class="text-sm text-zinc-400">Tu dibujo, en el círculo de arriba:</p>
					{@render avatarPicker(data.account.avatar, 'Tu dibujo')}
					<div class="flex items-center gap-3">
						<button class="{primary} self-start">Guardar</button>
						{#if form && 'saved' in form && form.saved === 'avatar'}
							<span class="text-sm text-amber-400">✓ Guardado</span>
						{:else if form && 'section' in form && form.section === 'avatar'}
							<span class="text-sm text-red-400">{form.message}</span>
						{/if}
					</div>
				</form>
			{/if}
		</section>
		{#if data.twoFactor}
			{@const tf = data.twoFactor}
			<section class={section} id="dos-pasos">
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

<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { enhance } from '$app/forms';
	import { section, select, primary, secondary, dollars } from './styles.ts';
	import { cost } from 'comun/ai-spend.ts';
	import type { PageData, ActionData } from './$types';

	/** Inteligencia artificial: clave, crédito y modelos de OpenRouter. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	let testing = $state(false);
	/** «Lo que más gasta»: which one is being turned on, its cost said, waiting for «Encender». */
	let confirming = $state<'titles' | 'scenes' | 'quote' | null>(null);
	const COSTLY = {
		titles: {
			title: 'Poner títulos y numeración a los capítulos',
			does: 'En cada serie, el botón «Poner títulos con la IA»: le manda la lista de episodios de Wikipedia y tres fotogramas de cada capítulo al modelo de escenas y títulos, el más caro.',
			price: (c: { titles: number | null }, batch: number) =>
				c.titles === null ? null : `unos ${cost(c.titles)} por cada ${batch} capítulos`
		},
		scenes: {
			title: 'Poner nombre a las escenas de las películas',
			does: 'En cada película con capítulos, el botón «Ponerles nombre con la IA»: le manda sus artículos de Wikipedia y un fotograma de cada capítulo. Los nombres ya puestos se quedan aunque lo apagues.',
			price: (c: { scenes: number | null }) =>
				c.scenes === null ? null : `unos ${cost(c.scenes)} por película`
		},
		quote: {
			title: 'Elegir las frases del rótulo de inicio',
			does: 'Cada vez que se abre la app, sin que nadie lo pida, le pasa los subtítulos de otro capítulo para elegir sus mejores frases, hasta haberlos visto todos. Apagado, el rótulo sale igual, con frases elegidas sin IA.',
			price: (c: { quote: number | null }) =>
				c.quote === null ? null : `unos ${cost(c.quote)} por capítulo, uno cada vez que se abre`
		}
	} as const;
</script>

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
			<p class={['mb-3 text-sm', data.ai.connected === 'ok' ? 'text-amber-400' : 'text-red-400']}>
				{{
					ok: '✓ Conectado con OpenRouter: la app ya tiene su clave.',
					cancelado: 'No se ha conectado: se canceló en OpenRouter.',
					caducado:
						'No se ha conectado: tardó demasiado o se empezó en otro navegador. Prueba otra vez.'
				}[data.ai.connected] ?? 'No se ha podido conectar con OpenRouter. Prueba otra vez.'}
			</p>
		{/if}
		{#if data.ai.keySource === 'seilide'}
			<p class="mb-2 text-sm">
				Usa la clave de OpenRouter de la familia, la de Seilide: allí se cambia, se le pone límite
				de gasto y se ve lo que se gasta. La clave no sale de Seilide; la casa le pide a Seilide y
				Seilide a OpenRouter.
			</p>
			<form method="post" action="?seccion={tab}&/aiSource" use:enhance class="mb-4">
				<input type="hidden" name="own" value="true" />
				<button class={secondary}>
					{data.ai.hasOwnKey ? 'Usar la clave propia de la casa' : 'Usar una clave propia'}
				</button>
			</form>
		{:else if data.ai.keySource === 'env'}
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
				Entras en OpenRouter (o te creas la cuenta), lo autorizas y vuelves aquí con la clave hecha.
				Lo que se use se paga con el crédito de esa cuenta.
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
		{#if data.ai.keySource !== 'seilide' && data.ai.canUseSeilide}
			<form method="post" action="?seccion={tab}&/aiSource" use:enhance class="mb-4 text-sm">
				<input type="hidden" name="own" value="false" />
				<button class={secondary}>Usar la clave de la familia, la de Seilide</button>
				<span class="ml-2 text-xs text-zinc-500">Una sola clave, con su límite, para todo.</span>
			</form>
		{/if}

		{#if data.ai.keyHint}
			<h3 id="credito" class="mb-2 text-sm text-zinc-300">Crédito y gasto</h3>
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
								Límite de esta clave: quedan {dollars(balance.left)} de {dollars(balance.limit!)}
							</p>
						{/if}
						<p class="text-zinc-400">
							Esta clave ha gastado hoy {dollars(balance.spent.day)} · esta semana {dollars(
								balance.spent.week
							)} · este mes {dollars(balance.spent.month)} · en total {dollars(balance.spent.total)}
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
					OpenRouter solo dice el crédito de la cuenta a una «clave de gestión», que se crea a mano
					en
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
					<Guardado class="self-center text-sm text-amber-400">✓</Guardado>
				{/if}
			</form>
		{/snippet}

		<h3 id="modelos" class="mb-2 text-sm text-zinc-300">Modelo para identificar películas</h3>
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
			Vacío usa {data.ai.defaultVisionModel}. Mira fotogramas: mejor uno que vea bien las imágenes y
			no razone antes de responder (los que razonan, como GPT-5 u o3, cuestan mucho más aquí).
		</p>

		<!-- The voice's own AI is Seilide's since #253: this one is only for these two. -->
		<h3 class="mb-2 text-sm text-zinc-300">Modelo para el DJ y las preguntas sobre los peques</h3>
		{@render modelForm(
			'voice',
			'Modelo para el DJ y las preguntas sobre los peques',
			data.ai.voiceModel,
			data.ai.defaultVoiceModel
		)}
		<p class="mb-4 text-xs text-zinc-500">
			Vacío usa {data.ai.defaultVoiceModel}. Escribe lo que dice el DJ entre canciones y contesta lo
			que preguntas sobre lo que ven los peques: mejor uno rápido y que use bien las herramientas.
			Lo que se dice a la voz lo entiende la IA de Seilide.
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
						>Más completo y con enlaces a las fuentes, pero cuesta algo más por pregunta (unos 0,7
						céntimos de búsqueda, más el texto que lee).</span
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
				<Guardado class="text-sm text-amber-400">✓ Funciona con {data.ai.model}</Guardado>
			{/if}
		</form>
		{#if form && 'section' in form && form.section === 'ai'}
			<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
		{/if}

		<h3 id="ia-cara" class="mt-6 mb-1 text-sm text-zinc-300">Lo que más gasta</h3>
		<p class="mb-3 text-sm text-zinc-400">
			Apagado hasta que lo enciendas: antes te decimos más o menos lo que cuesta.
		</p>
		<ul class="flex flex-col gap-3 text-sm">
			{#each ['titles', 'scenes', 'quote'] as const as which (which)}
				{@const on = data.ai.costly[which]}
				<li class="rounded-md border border-zinc-800 p-3">
					<p class="text-zinc-200">
						{COSTLY[which].title} ·
						<span class={on ? 'text-amber-400' : 'text-zinc-500'}
							>{on ? 'encendido' : 'apagado'}</span
						>
					</p>
					<p class="mt-1 text-xs text-zinc-500">{COSTLY[which].does}</p>
					{#if confirming === which}
						<p class="mt-2 text-amber-300">
							{#await data.ai.costly.cost}
								Mirando lo que cuesta…
							{:then c}
								{@const price = COSTLY[which].price(c, data.ai.costly.batch)}
								{price
									? `Cuesta ${price}, con los precios de hoy de OpenRouter, de tu crédito.`
									: 'No he podido ver los precios de OpenRouter: gasta de tu crédito.'}
							{/await}
						</p>
					{/if}
					<form
						method="post"
						action="?seccion={tab}&/costlyAi"
						use:enhance={() =>
							async ({ update }) => {
								await update({ reset: false });
								confirming = null;
							}}
						class="mt-2 flex gap-2"
					>
						<input type="hidden" name="which" value={which} />
						{#if on}
							<input type="hidden" name="on" value="false" />
							<button class={secondary}>Apagar</button>
						{:else if confirming === which}
							<input type="hidden" name="on" value="true" />
							<button class={primary}>Encender</button>
							<button type="button" class={secondary} onclick={() => (confirming = null)}
								>Mejor no</button
							>
						{:else}
							<button type="button" class={secondary} onclick={() => (confirming = which)}
								>Encender…</button
							>
						{/if}
					</form>
				</li>
			{/each}
		</ul>
	</section>
{/if}

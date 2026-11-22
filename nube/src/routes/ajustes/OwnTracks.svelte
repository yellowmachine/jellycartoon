<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import { agoText } from '#lib/cars.ts';
	import { primary, secondary, section } from '#lib/styles.ts';
	import { REGION_RADIUS } from '#lib/owntracks.ts';
	import type { ActionData, PageData } from './$types';

	/**
	 * OwnTracks (#593): the person's phone sending where it is, in the background, to Seilide. One
	 * button gives a password and the link that configures the app with it: shown once, as the
	 * walks' links. Its positions, in Paseos → OwnTracks.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	interface Made {
		link: string;
		qr: string;
		url: string;
		username: string;
		password: string;
	}
	/** Another action's answer may have any key (a Record): only this one's is read. */
	const made = $derived((form as { owntracksMade?: Made } | null)?.owntracksMade ?? null);
	const status = $derived(data.owntracks);
	/** «Conectar otra vez», asked before: the phone with the old one stops sending. */
	let again = $state(false);
</script>

<section class={section} id="owntracks">
	<h2 class="mb-1 font-semibold">OwnTracks</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Una app libre para Android que manda dónde está tu móvil, también con la pantalla apagada y
		gastando poca batería. Lo que manda solo lo ves tú, en <a
			href="/paseos/owntracks"
			class="text-amber-400 hover:underline">Paseos → OwnTracks</a
		>: las posiciones se guardan 90 días; de los días anteriores queda solo lo andado.
	</p>

	{#if made}
		<div class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
			<p class="mb-3">
				Con <a
					href="https://play.google.com/store/apps/details?id=org.owntracks.android"
					target="_blank"
					rel="noreferrer"
					class="text-amber-400 hover:underline">OwnTracks</a
				> instalado, ábrelo en el móvil: se configura solo. Este enlace solo se ve ahora.
			</p>
			<a href={made.link} class="{primary} mb-3 inline-block">Abrir en OwnTracks</a>
			<p class="mb-1 text-zinc-400">Desde el ordenador, con la cámara del móvil:</p>
			<img src={made.qr} alt="Código QR para configurar OwnTracks" class="mb-3 size-48 bg-white" />
			<details class="text-zinc-400">
				<summary class="cursor-pointer">Ponerlo a mano</summary>
				<p class="mt-2">
					En OwnTracks: Ajustes → Conexión → Modo <b>HTTP</b>, y en Identificación:
				</p>
				<dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all">
					<dt>URL</dt>
					<dd><code>{made.url}</code></dd>
					<dt>Usuario</dt>
					<dd><code>{made.username}</code></dd>
					<dt>Contraseña</dt>
					<dd><code>{made.password}</code></dd>
				</dl>
			</details>
		</div>
	{/if}

	{#if status.connectedAt}
		<p class="mb-3 text-sm">
			Conectado {agoText(new Date(status.connectedAt), new Date())}.
			{#if status.last}
				Lo último llegó {agoText(new Date(status.last.receivedAt), new Date())}{status.last
					.battery !== null
					? `, con la batería al ${status.last.battery} %`
					: ''}.
			{:else}
				Aún no ha llegado nada.
			{/if}
		</p>
		<p class="mb-3 text-sm text-zinc-400">
			{#if status.places.length}
				Te avisa al llegar y al salir de {status.places.join(', ')} (a {REGION_RADIUS} m), para las reglas
				«cuando llegue a…» de
				<a href="/reglas" class="text-amber-400 hover:underline">Reglas</a>. Si guardas otro sitio
				en Viajes, pide otro enlace para que lo lleve.
			{:else}
				Con sitios guardados en Viajes, te avisa al llegar y salir de ellos, para las reglas «cuando
				llegue a…».
			{/if}
			{#if status.homeInexact}
				Casa no va: en Ajustes → Casa → Dónde vivís está solo el pueblo; quien administra puede
				pulsar allí «Usar mi ubicación» estando en casa.
			{/if}
		</p>
		<p class="mb-3 text-xs text-zinc-500">
			Gasta poco: una posición cada 500 m o 15 minutos. Para un paseo con buen recorrido, cambia en
			la app a modo <b>Move</b> (el icono de arriba) y vuelve después.
		</p>
		<div class="flex flex-wrap items-center gap-3">
			{#if again}
				<form
					method="post"
					action="?seccion={tab}&/owntracksConnect"
					use:enhance={() =>
						async ({ update }) => {
							again = false;
							await update();
						}}
				>
					<button class={primary}>Sí, uno nuevo</button>
				</form>
				<span class="text-sm text-zinc-400">El móvil con el de antes deja de mandar.</span>
			{:else}
				<button class={secondary} onclick={() => (again = true)}>Otro enlace</button>
			{/if}
			<ConfirmForm
				action="?seccion={tab}&/owntracksDisconnect"
				label="Desconectar"
				question="¿Desconectar OwnTracks? Tu móvil deja de mandar; lo ya guardado se queda."
				yes="Sí, desconectar"
				class="text-sm text-zinc-500 hover:text-red-400"
			/>
		</div>
	{:else if !made}
		<form method="post" action="?seccion={tab}&/owntracksConnect" use:enhance>
			<button class={primary}>Conectar</button>
		</form>
	{/if}

	{#if status.kept}
		<div class="mt-4">
			<ConfirmForm
				action="?seccion={tab}&/owntracksForget"
				label="Borrar todas mis posiciones"
				question="¿Borrar todo lo que ha mandado OwnTracks, también lo andado de los días antiguos? No se puede deshacer."
				yes="Sí, borrar"
				class="text-sm text-zinc-500 hover:text-red-400"
			/>
		</div>
	{/if}
</section>

<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import { primary, secondary, section } from '#lib/styles.ts';
	import type { ActionData, PageData } from './$types';

	/**
	 * Música en apps (#625): the family's bucket in Subsonic apps (Tempus), with a password only for
	 * them, shown once. Only with a bucket: the house's music has its own server, in jellycartoon.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	/** Another action's answer may have any key (a Record): only this one's is read. */
	const made = $derived((form as { appPassword?: string } | null)?.appPassword ?? null);
	/** «Generar otra», asked before: the apps with the old one stop working. */
	let again = $state(false);

	/** What was last copied, and whether it could be: said on its button a while. */
	let copied = $state<{ text: string; ok: boolean } | null>(null);
	let timer: ReturnType<typeof setTimeout>;
	async function copy(text: string) {
		const ok = await navigator.clipboard.writeText(text).then(
			() => true,
			() => false
		);
		copied = { text, ok };
		clearTimeout(timer);
		timer = setTimeout(() => (copied = null), 2500);
	}
	$effect(() => () => clearTimeout(timer));
</script>

{#snippet copyButton(text: string, what: string)}
	<button
		type="button"
		class="ml-2 inline-block min-h-9 px-2 font-sans text-sm text-amber-400 hover:underline"
		title="Copiar {what}"
		onclick={() => copy(text)}
	>
		<span role="status">
			{copied?.text === text ? (copied.ok ? 'Copiado ✓' : 'No se pudo: cópialo a mano') : 'Copiar'}
		</span>
	</button>
{/snippet}

{#if data.musicSources.own && data.musicApps}
	{@const apps = data.musicApps}
	<section class={section} id="musica-en-apps">
		<h2 class="mb-1 font-semibold">Música en apps</h2>
		<p class="mb-4 text-sm text-zinc-400">
			La música de vuestro almacenamiento, en apps que hablan Subsonic, como
			<a
				href="https://github.com/eddyizm/tempus"
				target="_blank"
				rel="noreferrer"
				class="text-amber-400 hover:underline">Tempus</a
			>. Con una contraseña solo para eso, aparte de la de tu cuenta.{#if data.musicSources.house}
				La de casa va aparte: en Tempus, otro servidor.{/if}
		</p>
		<dl class="mb-4 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
			<dt class="text-zinc-400">Servidor</dt>
			<dd class="font-mono break-all">
				{apps.server}{@render copyButton(apps.server, 'el servidor')}
			</dd>
			<dt class="text-zinc-400">Usuario</dt>
			<dd class="font-mono break-all">
				{apps.username}{@render copyButton(apps.username, 'el usuario')}
			</dd>
			<dt class="text-zinc-400">Contraseña</dt>
			<dd>
				{#if made}
					<span class="font-mono text-amber-300 select-all">{made}</span>{@render copyButton(
						made,
						'la contraseña'
					)}
					<span class="block text-xs text-zinc-400">
						Cópiala ahora en la app: no se vuelve a enseñar.
					</span>
				{:else if apps.since}
					Creada el {apps.since.toLocaleDateString('es-ES')}
				{:else}
					<span class="text-zinc-400">Ninguna</span>
				{/if}
			</dd>
		</dl>
		<div class="flex flex-wrap items-center gap-3">
			{#if apps.since && !again}
				<button class={secondary} onclick={() => (again = true)}>Generar otra</button>
			{:else}
				<form
					method="post"
					action="?seccion={tab}&/appPassword"
					use:enhance={() =>
						async ({ update }) => {
							again = false;
							await update();
						}}
				>
					<button class={primary}>{again ? 'Sí, otra' : 'Generar contraseña'}</button>
				</form>
				{#if again}
					<span class="text-sm text-zinc-400">Las apps con la de antes se quedan sin acceso.</span>
				{/if}
			{/if}
			{#if apps.since}
				<ConfirmForm
					action="?seccion={tab}&/revokeAppPassword"
					label="Quitar"
					question="¿Quitar la contraseña? Las apps dejan de poder pedir música; lo que ya estén poniendo puede seguir hasta seis horas."
					yes="Sí, quitar"
					class="text-sm text-zinc-500 hover:text-red-400"
				/>
			{/if}
		</div>
		<p class="mt-3 text-xs text-zinc-500">
			Suena el fichero tal cual, sin comprimir para datos móviles. Según vuestro almacenamiento, lo
			que se escuche puede pagarse como descarga: en Cloudflare R2 no se cobra; en Amazon S3, sí.
		</p>
	</section>
{/if}

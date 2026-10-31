<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { enhance } from '$app/forms';
	import { section, select, primary, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Tu Telegram (#243): conectado una vez, en el modo carretera se leen en voz alta los mensajes
	 * que te llegan; y de los chats que elijas, Seilide aprende (#331). Datos de my.telegram.org, el
	 * número, el código y, si la tiene, la contraseña.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const account = $derived(data.telegram?.account ?? null);
	/** Where it goes in connecting it, as the last answer says. */
	const step = $derived(
		form && 'telegramStep' in form && form.telegramStep !== 'done' ? form.telegramStep : null
	);
	const problem = $derived(form && 'telegramProblem' in form ? form.telegramProblem : null);
	/** Their latest chats, and those chosen that are no longer among them. */
	const chatsToLearn = $derived([
		...(data.telegram?.chats ?? []),
		...(account?.learnChats ?? []).filter(
			(l) => !(data.telegram?.chats ?? []).some((c) => c.id === l.id)
		)
	]);
	let sending = $state(false);

	const keep = () => {
		sending = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			sending = false;
		};
	};
</script>

{#if data.telegram}
	<section class={section} id="telegram">
		<h2 class="mb-1 font-semibold">Telegram</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Tu cuenta de Telegram, para que en el modo carretera se lean en voz alta los mensajes que te
			llegan, sin mirar el móvil. Se queda en el ordenador de casa, cifrada; la app no escribe nada
			en tu nombre.
		</p>

		{#if account}
			<p class="mb-3 text-sm">
				Conectada: <strong>{account.name ?? 'tu cuenta'}</strong>
				{#if !account.listening}<span class="text-amber-400"> · conectando…</span>{/if}
			</p>
			<form
				method="post"
				action="?seccion={tab}&/telegramOptions"
				use:enhance={keep}
				class="mb-3 flex flex-col gap-2 text-sm"
			>
				<label class="flex items-center gap-2">
					<input type="checkbox" name="groups" checked={account.groups} class="rounded" />
					Leer también los grupos (si no, solo los chats con una persona)
				</label>
				<label class="flex items-center gap-2">
					<input type="checkbox" name="markRead" checked={account.markRead} class="rounded" />
					Marcarlos como leídos al leerlos
				</label>
				<fieldset class="mt-2">
					<legend class="font-medium">Aprender de estos chats</legend>
					<p class="mb-2 text-xs text-zinc-500">
						Lo que se dice en ellos (lo que te mandan y lo que mandas) pasa a Seilide, que te deja
						en tu Buzón lo que merezca recordarse («llegamos el sábado a las 11») para que lo
						guardes o no. Lo lee la IA de la familia en OpenRouter, o el Ollama de casa si falla.
					</p>
					<div class="flex max-h-48 flex-col gap-1 overflow-y-auto">
						{#each chatsToLearn as c (c.id)}
							<label class="flex items-center gap-2">
								<input
									type="checkbox"
									name="learn"
									value={c.id}
									checked={account.learnChats.some((l) => l.id === c.id)}
									class="rounded"
								/>
								{c.name}
							</label>
						{:else}
							<span class="text-xs text-zinc-500">Telegram aún no ha dado tus chats.</span>
						{/each}
					</div>
				</fieldset>
				<div class="flex flex-wrap items-center gap-3">
					<button class={primary} disabled={sending}>Guardar</button>
					<button
						class="text-sm text-red-400 hover:underline"
						formaction="?seccion={tab}&/telegramDisconnect">Desconectar</button
					>
					{#if form && 'saved' in form && form.saved === 'telegram'}
						<Guardado class="text-amber-400">✓ Guardado</Guardado>
					{/if}
				</div>
			</form>
		{:else if step === 'code'}
			<form
				method="post"
				action="?seccion={tab}&/telegramSignIn"
				use:enhance={keep}
				class="flex flex-wrap items-end gap-3 text-sm"
			>
				<label class="flex flex-col gap-1 text-zinc-300">
					El código que te ha mandado Telegram (en su app, o por SMS)
					<input
						name="code"
						inputmode="numeric"
						autocomplete="one-time-code"
						required
						class="{select} w-40 font-mono"
					/>
				</label>
				<button class={primary} disabled={sending}>Entrar</button>
			</form>
		{:else if step === 'password'}
			<form
				method="post"
				action="?seccion={tab}&/telegramPassword"
				use:enhance={keep}
				class="flex flex-wrap items-end gap-3 text-sm"
			>
				<label class="flex flex-col gap-1 text-zinc-300">
					Tu contraseña de Telegram (verificación en dos pasos)
					<input name="password" type="password" required class={select} />
				</label>
				<button class={primary} disabled={sending}>Entrar</button>
			</form>
		{:else}
			<p class="mb-3 text-sm text-zinc-400">
				En <a href="https://my.telegram.org" target="_blank" rel="noreferrer" class="underline"
					>my.telegram.org</a
				>, con tu número: «API development tools», crea una aplicación (el nombre da igual) y copia
				su api_id y su api_hash.
			</p>
			<form
				method="post"
				action="?seccion={tab}&/telegramCode"
				use:enhance={keep}
				class="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:items-center"
			>
				<label for="tgApiId" class="text-zinc-300">api_id</label>
				<input id="tgApiId" name="apiId" inputmode="numeric" required class="{select} font-mono" />
				<label for="tgApiHash" class="text-zinc-300">api_hash</label>
				<input
					id="tgApiHash"
					name="apiHash"
					type="password"
					autocomplete="off"
					required
					class="{select} font-mono"
				/>
				<label for="tgPhone" class="text-zinc-300">Tu número</label>
				<input
					id="tgPhone"
					name="phone"
					type="tel"
					autocomplete="tel"
					placeholder="+34 600 000 000"
					required
					class={select}
				/>
				<div class="sm:col-start-2">
					<button class={secondary} disabled={sending}
						>{sending ? 'Pidiendo el código…' : 'Pedir el código'}</button
					>
				</div>
			</form>
		{/if}
		{#if problem}<p class="mt-2 text-sm text-red-400">{problem}</p>{/if}
	</section>
{/if}

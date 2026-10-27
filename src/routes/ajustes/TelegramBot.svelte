<script lang="ts">
	import { enhance } from '$app/forms';
	import { section, select, primary, secondary } from './styles.ts';
	import { BOT_EVENTS, type BotEvent } from '#lib/telegram-bot.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * El bot de Telegram de la casa (#243): avisa en el grupo de la familia de la lista de la compra,
	 * la nevera, la agenda y las alarmas, diciendo quién hizo qué.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const bot = $derived(data.telegramBot?.bot ?? null);
	const problem = $derived(form && 'botProblem' in form ? form.botProblem : null);
	const saved = $derived(form && 'saved' in form ? form.saved : null);
	/** What is being done, from the button pressed: its form's action. */
	let busy = $state<string | null>(null);
	const keep = ({ action }: { action: URL }) => {
		busy = action.search.split('/').at(-1) ?? null;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = null;
		};
	};
</script>

{#if data.telegramBot}
	<section class={section} id="telegram-bot">
		<h2 class="mb-1 font-semibold">Bot de Telegram</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Un bot de la casa que avisa en el grupo de Telegram de la familia: «🛒 María ha añadido a la
			lista: leche y pan». En el grupo sale como el bot, y dice quién hizo cada cosa.
		</p>

		{#if bot}
			<p class="mb-3 text-sm">
				Conectado: <strong>@{bot.username}</strong>
				{#if !bot.running}<span class="text-amber-400"> · arrancando…</span>{/if}
			</p>
			{#if !bot.chats.length}
				<p class="mb-3 text-sm text-zinc-400">
					Añádelo al grupo de la familia (en Telegram, el grupo → Añadir miembro → @{bot.username}).
					Si ya estaba, escribe <code>/start</code> en el grupo. Aparecerá aquí.
				</p>
			{/if}
			<form
				method="post"
				action="?seccion={tab}&/botOptions"
				use:enhance={keep}
				class="mb-3 flex flex-col gap-2 text-sm"
			>
				{#if bot.chats.length}
					<label class="flex flex-wrap items-center gap-2">
						Avisa en
						<select name="chat" class={select}>
							{#each bot.chats as c (c.id)}
								<option value={c.id} selected={bot.chat?.id === c.id}>{c.title}</option>
							{/each}
						</select>
					</label>
				{/if}
				{#each Object.entries(BOT_EVENTS) as [key, label] (key)}
					<label class="flex items-center gap-2">
						<input
							type="checkbox"
							name={key}
							checked={bot.events[key as BotEvent]}
							class="rounded"
						/>
						{label}
					</label>
				{/each}
				<div class="flex flex-wrap items-center gap-3">
					<button class={primary} disabled={busy !== null}
						>{busy === 'botOptions' ? 'Guardando…' : 'Guardar'}</button
					>
					{#if bot.chat}
						<button class={secondary} formaction="?seccion={tab}&/botTest" disabled={busy !== null}
							>{busy === 'botTest' ? 'Enviando…' : 'Enviar una prueba'}</button
						>
					{/if}
					<button
						class="text-sm text-red-400 hover:underline"
						formaction="?seccion={tab}&/botForget">Desconectar</button
					>
					{#if saved === 'bot-options'}<span class="text-amber-400">✓ Guardado</span>{/if}
					{#if saved === 'bot-test'}<span class="text-amber-400">✓ Enviada al grupo</span>{/if}
				</div>
			</form>
		{:else}
			<p class="mb-3 text-sm text-zinc-400">
				En Telegram, habla con <strong>@BotFather</strong>: <code>/newbot</code>, ponle un nombre
				(«JellyCartoon») y un usuario acabado en «bot». Te dará un token: pégalo aquí.
			</p>
			<form
				method="post"
				action="?seccion={tab}&/botToken"
				use:enhance={keep}
				class="flex flex-wrap items-end gap-3 text-sm"
			>
				<label class="flex min-w-64 flex-1 flex-col gap-1 text-zinc-300">
					Token del bot
					<input
						name="token"
						type="password"
						autocomplete="off"
						required
						placeholder="123456789:ABC…"
						class="{select} font-mono"
					/>
				</label>
				<button class={primary} disabled={busy !== null}
					>{busy === 'botToken' ? 'Conectando…' : 'Conectar'}</button
				>
			</form>
		{/if}
		{#if problem}<p class="mt-2 text-sm text-red-400">{problem}</p>{/if}
	</section>
{/if}

<script lang="ts">
	import { page } from '$app/state';
	import Caracol from '#lib/components/Caracol.svelte';
	import Chat from '#lib/components/Chat.svelte';
	import { chatPanel } from '#lib/chat-panel.svelte.ts';
	import type { ChatMessage } from '#lib/chat.ts';
	import { onMount } from 'svelte';

	/**
	 * «Preguntar» on the right of any page (#504), on a wide screen: as tall as the window, scrolled
	 * on its own; the page and its bar leave it the room (the layout). The same chat as its page, which knows the page beside it. The
	 * chat is read each time the panel appears (its page may have changed it), and kept while it
	 * stays open from page to page.
	 */
	let data = $state<{ messages: ChatMessage[]; toBuy: string[]; hasAi: boolean } | null>(null);
	let problem = $state<string | null>(null);

	async function load() {
		problem = null;
		try {
			const res = await fetch('/api/preguntar');
			if (!res.ok) throw new Error(String(res.status));
			data = await res.json();
		} catch {
			problem = 'No se pudo abrir la conversación.';
		}
	}

	onMount(() => void load());
</script>

<aside
	aria-label="Preguntar"
	class="fixed inset-y-0 right-0 z-20 hidden w-96 flex-col overflow-y-auto overscroll-contain border-l border-zinc-800 bg-zinc-950 px-4 pt-4 lg:flex"
>
	{#if data}
		<Chat
			messages={data.messages}
			toBuy={data.toBuy}
			hasAi={data.hasAi}
			path={page.url.pathname}
			compact
		>
			{#snippet heading()}
				<div class="flex items-center gap-1">
					<h2 class="mr-1 text-lg font-bold">Preguntar</h2>
					<a
						href="/preguntar"
						title="Abrir en grande"
						aria-label="Abrir en grande"
						class="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="h-4 w-4"
							aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg
						>
					</a>
					<button
						title="Cerrar"
						aria-label="Cerrar Preguntar"
						class="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
						onclick={() => chatPanel.toggle()}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							class="h-4 w-4"
							aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg
						>
					</button>
				</div>
			{/snippet}
		</Chat>
	{:else if problem}
		<p class="text-sm text-red-400">{problem}</p>
		<button
			class="mt-2 self-start rounded-md px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
			onclick={() => void load()}>Probar otra vez</button
		>
	{:else}
		<Caracol modo="reptar" class="mx-auto mt-10 w-12 text-emerald-500" />
	{/if}
</aside>

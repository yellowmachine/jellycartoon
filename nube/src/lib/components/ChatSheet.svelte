<script lang="ts">
	import { page } from '$app/state';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import Caracol from '#lib/components/Caracol.svelte';
	import Chat from '#lib/components/Chat.svelte';
	import { readChat, type ChatData } from '#lib/chat-panel.svelte.ts';
	import { sectionIcon, sectionOfPath } from '#lib/nav.ts';
	import { tick, untrack } from 'svelte';

	/**
	 * «Preguntar» on a phone or a tablet: a sheet from below over the page, which stays as it was
	 * under it. A strip at the top says which section it is; tapped, or dragged down, it goes back
	 * there, as Android's back does (the layout's history entry). Closed it is only hidden: what was
	 * being written stays, and an answer on its way arrives.
	 */
	let { shown, onclose }: { shown: boolean; onclose: () => void } = $props();

	let data = $state<ChatData | null>(null);
	let problem = $state<string | null>(null);

	async function load() {
		problem = null;
		try {
			data = await readChat();
		} catch {
			problem = 'No se pudo abrir la conversación.';
		}
	}

	const section = $derived(sectionOfPath(page.url.pathname));
	const icon = $derived(section && sectionIcon(section.path));
	const label = $derived(section?.label ?? 'la página');

	let scroller: HTMLElement | undefined = $state();
	/**
	 * What the keyboard leaves free: neither iOS nor Chrome shrinks a fixed element for it, so the
	 * box to write in would be under it. Not while zoomed in, which shrinks it too.
	 */
	let room = $state<{ top: number; height: number } | null>(null);

	$effect(() => {
		if (!shown) return;
		untrack(() => void load());
		// The page under it does not move with the sheet's scroll.
		const root = document.documentElement;
		const overflow = root.style.overflow;
		root.style.overflow = 'hidden';
		const vv = window.visualViewport;
		const fit = async () => {
			if (!vv || Math.abs(vv.scale - 1) > 0.01) return;
			const before = scroller?.clientHeight ?? 0;
			room = { top: vv.offsetTop, height: vv.height };
			await tick();
			// What was being read stays just over the box.
			if (scroller && before) scroller.scrollTop += before - scroller.clientHeight;
		};
		untrack(() => void fit());
		vv?.addEventListener('resize', fit);
		vv?.addEventListener('scroll', fit);
		return () => {
			root.style.overflow = overflow;
			vv?.removeEventListener('resize', fit);
			vv?.removeEventListener('scroll', fit);
			room = null;
			dragFrom = null;
			dragged = 0;
		};
	});

	const DRAG_CLOSES = 60;
	let dragFrom: number | null = $state(null);
	let dragged = $state(0);
	function drop() {
		const far = dragged > DRAG_CLOSES;
		dragFrom = null;
		dragged = 0;
		if (far) onclose();
	}
</script>

<div
	role="dialog"
	aria-label="Preguntar"
	class={[
		'fixed inset-x-0 z-30 flex-col bg-zinc-950 transition-[translate,display] transition-discrete duration-200 motion-reduce:transition-none',
		shown ? 'flex starting:translate-y-full' : 'hidden translate-y-full'
	]}
	style:top="{room?.top ?? 0}px"
	style:height={room ? `${room.height}px` : '100dvh'}
	style:translate={dragged ? `0 ${dragged}px` : null}
	style:transition={dragFrom === null ? null : 'none'}
>
	<button
		type="button"
		aria-label="Volver a {label}"
		class="flex h-13 shrink-0 touch-none items-center gap-2 border-b border-zinc-700 bg-zinc-900 px-4 text-left text-zinc-300 select-none"
		onclick={onclose}
		onpointerdown={(e) => {
			e.currentTarget.setPointerCapture(e.pointerId);
			dragFrom = e.clientY;
		}}
		onpointermove={(e) => {
			if (dragFrom !== null) dragged = Math.max(0, e.clientY - dragFrom);
		}}
		onpointerup={drop}
		onpointercancel={() => {
			dragFrom = null;
			dragged = 0;
		}}
	>
		{#if icon}<SectionIcon name={icon} class="h-5 w-5 shrink-0" />{/if}
		<span class="min-w-0 flex-1 truncate font-medium">{label}</span>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="h-5 w-5 shrink-0 text-zinc-500"
			aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
		>
	</button>
	<div
		bind:this={scroller}
		class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4"
	>
		{#if data}
			<Chat
				messages={data.messages}
				toBuy={data.toBuy}
				hasAi={data.hasAi}
				path={page.url.pathname + page.url.search}
				compact
				over={onclose}
			>
				{#snippet heading()}
					<div class="flex items-center gap-1">
						<h2 class="mr-1 text-lg font-bold">Preguntar</h2>
						<a
							href="/preguntar"
							title="Abrir en grande"
							aria-label="Abrir en grande"
							class="rounded-md p-2 text-zinc-500 hover:bg-zinc-800 hover:text-white"
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
					</div>
				{/snippet}
			</Chat>
		{:else if problem}
			<p class="mt-4 text-sm text-red-400">{problem}</p>
			<button
				class="mt-2 self-start rounded-md px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
				onclick={() => void load()}>Probar otra vez</button
			>
		{:else}
			<Caracol modo="reptar" class="mx-auto mt-14 w-12 text-emerald-500" />
		{/if}
	</div>
</div>

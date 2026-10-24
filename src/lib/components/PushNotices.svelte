<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * The adults' notices on this phone with the app closed (Web Push, push.ts): the fridge's
	 * post-its and shopping list (#131), and a child asking to enter (#141) for who looks after one.
	 * The browser asks for permission; the service worker shows them.
	 */
	let { guardian = false }: { guardian?: boolean } = $props();
	type Status = 'loading' | 'unsupported' | 'blocked' | 'off' | 'on' | 'busy';

	let status = $state<Status>('loading');
	let problem = $state<string | null>(null);
	/** On an iPhone, only from the app added to the home screen (iOS 16.4 or later). */
	const iphone = typeof navigator !== 'undefined' && /iPhone|iPad/.test(navigator.userAgent);

	async function registration() {
		// Registered by SvelteKit in production; in development there is none.
		return navigator.serviceWorker.getRegistration();
	}

	onMount(async () => {
		if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.isSecureContext)
			return (status = 'unsupported');
		if (Notification.permission === 'denied') return (status = 'blocked');
		const subscription = await (await registration())?.pushManager.getSubscription();
		if (!subscription) return (status = 'off');
		const res = await fetch(`/api/push?endpoint=${encodeURIComponent(subscription.endpoint)}`);
		status = res.ok && (await res.json()).subscribed ? 'on' : 'off';
	});

	async function turnOn() {
		status = 'busy';
		problem = null;
		try {
			const reg = await registration();
			if (!reg)
				throw new Error('La app todavía no está lista en este navegador: recarga la página.');
			if ((await Notification.requestPermission()) !== 'granted') return (status = 'blocked');
			const { publicKey } = await (await fetch('/api/push')).json();
			const subscription =
				(await reg.pushManager.getSubscription()) ??
				(await reg.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: publicKey
				}));
			const res = await fetch('/api/push', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(subscription.toJSON())
			});
			if (!res.ok) throw new Error('No se pudo guardar');
			status = 'on';
		} catch (err) {
			problem = err instanceof Error ? err.message : String(err);
			status = 'off';
		}
	}

	async function turnOff() {
		status = 'busy';
		const subscription = await (await registration())?.pushManager.getSubscription();
		if (subscription) {
			await fetch('/api/push', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ endpoint: subscription.endpoint })
			}).catch(() => {});
			await subscription.unsubscribe().catch(() => {});
		}
		status = 'off';
	}
</script>

<div class="mt-4 border-t border-zinc-800 pt-4">
	<h3 class="mb-1 text-sm text-zinc-300">Avisos en este dispositivo</h3>
	<p class="mb-2 text-sm text-zinc-400">
		Te llegan aunque la app esté cerrada: un post-it nuevo en la nevera o algo añadido a la lista de
		la compra{guardian ? ', y cuando un peque quiera entrar en un dispositivo de la casa' : ''}.
	</p>
	{#if status === 'loading'}
		<p class="text-sm text-zinc-500">…</p>
	{:else if status === 'unsupported'}
		<p class="text-sm text-zinc-500">
			{iphone
				? 'En el iPhone, añade la app a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y actívalo desde allí.'
				: 'Este navegador no puede recibir avisos.'}
		</p>
	{:else if status === 'blocked'}
		<p class="text-sm text-amber-400">
			Los avisos están bloqueados para esta web: permítelos en los ajustes del navegador.
		</p>
	{:else if status === 'on'}
		<div class="flex items-center gap-3 text-sm">
			<span class="text-amber-400">✓ Activados en este dispositivo</span>
			<button class="text-zinc-400 hover:text-white hover:underline" onclick={turnOff}
				>Desactivar</button
			>
		</div>
	{:else}
		<button
			class="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
			disabled={status === 'busy'}
			onclick={turnOn}>Activar avisos en este dispositivo</button
		>
	{/if}
	{#if problem}
		<p class="mt-2 text-sm text-red-400">{problem}</p>
	{/if}
</div>

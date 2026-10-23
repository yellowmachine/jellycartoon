<script lang="ts">
	import { onMount } from 'svelte';
	import { avatar } from '#lib/avatars.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/**
	 * «¿Quién eres?» (#141): the children choose their avatar with the remote, and wait here while
	 * one of their parents says yes or no on the phone.
	 */
	type Step =
		| { step: 'choose' }
		| { step: 'waiting'; kid: (typeof data.kids)[number] }
		| { step: 'entering'; kid: (typeof data.kids)[number] }
		| { step: 'no'; kid: (typeof data.kids)[number]; message: string };

	let now = $state<Step>({ step: 'choose' });
	let events: EventSource | null = null;
	let back: ReturnType<typeof setTimeout> | undefined;
	/** The remote needs something focused: the first avatar. */
	const focusFirst = () => document.querySelector<HTMLButtonElement>('[data-kid]')?.focus();

	onMount(() => {
		focusFirst();
		return stop;
	});

	function stop() {
		events?.close();
		events = null;
		clearTimeout(back);
	}

	function choose() {
		stop();
		now = { step: 'choose' };
		// After the buttons are drawn again.
		setTimeout(focusFirst);
	}

	/** Said for a few seconds, then back to the avatars. */
	function refuse(kid: (typeof data.kids)[number], message: string) {
		stop();
		now = { step: 'no', kid, message };
		back = setTimeout(choose, 6000);
	}

	async function enter(kid: (typeof data.kids)[number], body: object) {
		now = { step: 'entering', kid };
		const res = await fetch('/api/quien/entrar', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}).catch(() => null);
		if (!res?.ok) return refuse(kid, 'No se ha podido entrar. Pídelo otra vez.');
		// The whole page again: the session is new.
		location.assign(data.home);
	}

	async function ask(kid: (typeof data.kids)[number]) {
		stop();
		now = { step: 'waiting', kid };
		const res = await fetch('/api/quien/pedir', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kidId: kid.id })
		}).catch(() => null);
		if (!res?.ok) {
			const message = (await res?.json().catch(() => null))?.message;
			return refuse(kid, message ?? 'No se ha podido preguntar. Prueba otra vez.');
		}
		const answer: { permit?: true; requestId?: string } = await res.json();
		if (answer.permit) return enter(kid, { kidId: kid.id });
		events = new EventSource(`/api/quien/pedir/${answer.requestId}`);
		events.onmessage = (e) => {
			const state = JSON.parse(e.data);
			if (state === 'approved') {
				stop();
				void enter(kid, { requestId: answer.requestId });
			} else if (state === 'denied') refuse(kid, 'Ahora no te dejan entrar.');
			else if (state === 'expired')
				refuse(kid, 'No ha contestado nadie. Pregúntales y vuelve a probar.');
		};
	}
</script>

<svelte:head>
	<title>¿Quién eres? · JellyCartoon</title>
</svelte:head>

<div
	class="flex min-h-dvh flex-col items-center justify-center gap-10 bg-zinc-950 p-8 text-zinc-100"
>
	{#if now.step === 'choose'}
		<h1 class="text-4xl font-bold">¿Quién eres?</h1>
		{#if data.kids.length}
			<div class="flex flex-wrap justify-center gap-8">
				{#each data.kids as kid (kid.id)}
					{@const a = avatar(kid.avatar)}
					<button
						data-kid
						class="group flex flex-col items-center gap-3 rounded-3xl p-3 focus-visible:outline-amber-400"
						onclick={() => ask(kid)}
					>
						<span
							class="flex h-36 w-36 items-center justify-center rounded-full text-7xl shadow-xl transition group-hover:scale-105 group-focus-visible:scale-110 {a.color}"
							>{a.emoji}</span
						>
						<span class="text-2xl font-semibold">{kid.name}</span>
					</button>
				{/each}
			</div>
		{:else}
			<p class="max-w-md text-center text-xl text-zinc-400">
				Todavía no hay peques que entren eligiendo su dibujo. Un adulto lo prepara en Ajustes →
				Casa.
			</p>
		{/if}
		<a href="/login?adulto" class="rounded-lg px-4 py-2 text-lg text-zinc-400 hover:text-white"
			>Soy un adulto</a
		>
	{:else}
		{@const a = avatar(now.kid.avatar)}
		<span
			class={[
				'flex h-44 w-44 items-center justify-center rounded-full text-8xl shadow-xl',
				a.color,
				now.step === 'waiting' && 'animate-pulse'
			]}>{a.emoji}</span
		>
		<p class="text-center text-3xl font-semibold" aria-live="polite">
			{#if now.step === 'waiting'}
				¡Hola, {now.kid.name}! Esperando a que papá o mamá te dejen entrar…
			{:else if now.step === 'entering'}
				¡Adelante, {now.kid.name}!
			{:else}
				{now.message}
			{/if}
		</p>
		{#if now.step !== 'entering'}
			<!-- svelte-ignore a11y_autofocus -->
			<button
				autofocus
				class="rounded-xl bg-zinc-800 px-6 py-3 text-xl hover:bg-zinc-700 focus-visible:outline-amber-400"
				onclick={choose}>{now.step === 'waiting' ? 'Cancelar' : 'Volver'}</button
			>
		{/if}
	{/if}
</div>

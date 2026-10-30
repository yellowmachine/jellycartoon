<script lang="ts">
	import { onMount } from 'svelte';
	import { avatar } from 'comun/avatars.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/**
	 * «¿Quién eres?» (#303, as jellycartoon's #141): the children choose their drawing, and wait
	 * here while one of their adults says yes or no on the phone.
	 */
	type Kid = (typeof data.kids)[number];
	type Step =
		| { step: 'choose' }
		| { step: 'waiting'; kid: Kid }
		| { step: 'entering'; kid: Kid }
		| { step: 'no'; kid: Kid; message: string };

	let now = $state<Step>({ step: 'choose' });
	let events: EventSource | null = null;
	let back: ReturnType<typeof setTimeout> | undefined;
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

	/** Said for a few seconds, then back to the drawings. */
	function refuse(kid: Kid, message: string) {
		stop();
		now = { step: 'no', kid, message };
		back = setTimeout(choose, 6000);
	}

	async function enter(kid: Kid, body: object) {
		now = { step: 'entering', kid };
		const res = await fetch('/api/quien/entrar', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}).catch(() => null);
		if (!res?.ok) return refuse(kid, 'No se ha podido entrar. Pídelo otra vez.');
		// The whole page again: the session is new.
		location.assign('/');
	}

	async function ask(kid: Kid) {
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
	<title>¿Quién eres? · Seilide</title>
</svelte:head>

<div class="flex min-h-[80dvh] flex-col items-center justify-center gap-10 p-8">
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
							class="flex h-32 w-32 items-center justify-center rounded-full text-7xl shadow-xl transition group-hover:scale-105 group-focus-visible:scale-110 {a.color}"
							>{a.emoji}</span
						>
						<span class="text-2xl font-semibold">{kid.name}</span>
					</button>
				{/each}
			</div>
		{:else}
			<p class="text-zinc-400">Todavía no hay peques con cuenta en la familia.</p>
		{/if}
		<a href="/login?adulto" class="rounded-lg px-4 py-2 text-zinc-400 hover:text-white"
			>Entrar con contraseña</a
		>
	{:else}
		{@const a = avatar(now.kid.avatar)}
		<span
			class={[
				'flex h-40 w-40 items-center justify-center rounded-full text-8xl shadow-xl',
				a.color,
				now.step === 'waiting' && 'animate-pulse'
			]}>{a.emoji}</span
		>
		<p class="text-center text-3xl font-semibold" aria-live="polite">
			{#if now.step === 'waiting'}
				¡Hola, {now.kid.name}! Esperando a que te dejen entrar…
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

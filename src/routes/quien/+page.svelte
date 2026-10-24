<script lang="ts">
	import { onMount } from 'svelte';
	import { avatar } from '#lib/avatars.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/**
	 * «¿Quién eres?» (#141): the children choose their avatar with the remote, and wait here while
	 * one of their parents says yes or no on the phone. An adult (#172) chooses theirs, and says yes
	 * on their own phone: with the notice it gets, or reading the QR shown here.
	 */
	type Kid = (typeof data.kids)[number];
	type Adult = (typeof data.adults)[number];
	type Step =
		| { step: 'choose' }
		| { step: 'waiting'; kid: Kid }
		| { step: 'entering'; kid: Kid }
		| { step: 'no'; kid: Kid; message: string }
		| { step: 'qr'; adult: Adult; qr: string | null }
		| { step: 'adult-entering'; adult: Adult }
		| { step: 'adult-no'; adult: Adult; message: string };

	let now = $state<Step>({ step: 'choose' });
	const initialOf = (name: string) => [...name.trim()][0]?.toLocaleUpperCase('es') ?? '?';
	let events: EventSource | null = null;
	let back: ReturnType<typeof setTimeout> | undefined;
	/** The remote needs something focused: the first avatar. */
	const focusFirst = () =>
		document.querySelector<HTMLButtonElement>('[data-kid], [data-adult]')?.focus();

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

	/** Said for a few seconds, then back to the drawings. */
	function refuseAdult(adult: Adult, message: string) {
		stop();
		now = { step: 'adult-no', adult, message };
		back = setTimeout(choose, 6000);
	}

	async function askAsAdult(adult: Adult) {
		stop();
		now = { step: 'qr', adult, qr: null };
		const res = await fetch('/api/quien/adulto', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ userId: adult.id })
		}).catch(() => null);
		if (!res?.ok) {
			const message = (await res?.json().catch(() => null))?.message;
			return refuseAdult(adult, message ?? 'No se ha podido pedir. Prueba otra vez.');
		}
		const { requestId, qr }: { requestId: string; qr: string } = await res.json();
		now = { step: 'qr', adult, qr };
		events = new EventSource(`/api/quien/adulto/${requestId}`);
		events.onmessage = async (e) => {
			const state = JSON.parse(e.data);
			if (state === 'approved') {
				stop();
				now = { step: 'adult-entering', adult };
				const entered = await fetch('/api/quien/adulto/entrar', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ requestId })
				}).catch(() => null);
				if (!entered?.ok) return refuseAdult(adult, 'No se ha podido entrar. Pídelo otra vez.');
				// The whole page again: the session is new.
				location.assign(data.home);
			} else if (state === 'denied') refuseAdult(adult, 'Dijiste que no desde el móvil.');
			else if (state === 'expired')
				refuseAdult(adult, 'Ha pasado el tiempo. Elige tu dibujo otra vez.');
		};
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
		{/if}
		{#if data.adults.length}
			<!-- The adults (#172), smaller: they enter from their phone. -->
			<div class="flex flex-wrap justify-center gap-6">
				{#each data.adults as adult (adult.id)}
					{@const a = adult.avatar ? avatar(adult.avatar) : null}
					<button
						data-adult
						class="group flex flex-col items-center gap-2 rounded-3xl p-2 focus-visible:outline-amber-400"
						onclick={() => askAsAdult(adult)}
					>
						<span
							class={[
								'flex h-24 w-24 items-center justify-center rounded-full shadow-xl transition group-hover:scale-105 group-focus-visible:scale-110',
								a ? `text-5xl ${a.color}` : 'bg-amber-500 text-4xl font-semibold text-zinc-950'
							]}>{a ? a.emoji : initialOf(adult.name)}</span
						>
						<span class="text-lg font-semibold">{adult.name}</span>
					</button>
				{/each}
			</div>
		{/if}
		<a href="/login?adulto" class="rounded-lg px-4 py-2 text-lg text-zinc-400 hover:text-white"
			>Entrar con contraseña</a
		>
	{:else if now.step === 'qr' || now.step === 'adult-entering' || now.step === 'adult-no'}
		{@const a = now.adult.avatar ? avatar(now.adult.avatar) : null}
		<span
			class={[
				'flex h-28 w-28 items-center justify-center rounded-full shadow-xl',
				a ? `text-6xl ${a.color}` : 'bg-amber-500 text-5xl font-semibold text-zinc-950'
			]}>{a ? a.emoji : initialOf(now.adult.name)}</span
		>
		{#if now.step === 'qr'}
			<p class="text-center text-3xl font-semibold">Hola, {now.adult.name}</p>
			{#if now.qr}
				<div class="w-64 rounded-xl bg-white p-2" aria-label="Código QR para entrar">
					{@html now.qr}
				</div>
			{/if}
			<p class="max-w-lg text-center text-xl text-zinc-400" aria-live="polite">
				Te hemos avisado en el móvil. Si no te llega, lee este código con su cámara y di que sí.
			</p>
		{:else if now.step === 'adult-entering'}
			<p class="text-center text-3xl font-semibold">¡Adelante, {now.adult.name}!</p>
		{:else}
			<p class="text-center text-3xl font-semibold">{now.message}</p>
		{/if}
		{#if now.step !== 'adult-entering'}
			<!-- svelte-ignore a11y_autofocus -->
			<button
				autofocus
				class="rounded-xl bg-zinc-800 px-6 py-3 text-xl hover:bg-zinc-700 focus-visible:outline-amber-400"
				onclick={choose}>{now.step === 'qr' ? 'Cancelar' : 'Volver'}</button
			>
		{/if}
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

<script lang="ts">
	import { OUTCOME_TEXT, talkTime } from '#lib/calls.ts';
	import { phone } from '#lib/phone.svelte.ts';

	/**
	 * The call on screen (#330), big, to be seen at a glance from the car's seat: who, how it is, and
	 * its buttons. «Contestar» green and «Colgar» red, as on every phone. The other's sound plays in
	 * an <audio> of the page (a detached one does not always sound, plasma-extension-audio).
	 */
	let { onclose }: { onclose?: () => void } = $props();

	let audio = $state<HTMLAudioElement>();
	let blocked = $state(false);
	$effect(() => {
		if (!audio) return;
		audio.srcObject = phone.remote;
		if (phone.remote)
			audio.play().then(
				() => (blocked = false),
				() => (blocked = true)
			);
	});

	let now = $state(Date.now());
	$effect(() => {
		if (phone.state !== 'connected') return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	const status = $derived(
		phone.state === 'calling'
			? 'Llamando…'
			: phone.state === 'incoming'
				? 'Te llama'
				: phone.state === 'connecting'
					? 'Conectando…'
					: phone.state === 'connected'
						? talkTime((now - (phone.connectedAt ?? now)) / 1000)
						: phone.outcome
							? `Llamada terminada · ${OUTCOME_TEXT[phone.outcome]}`
							: 'Llamada terminada'
	);

	const round =
		'flex h-24 w-24 items-center justify-center rounded-full text-white shadow-xl active:scale-95 short:h-16 short:w-16';
</script>

<section
	class="flex flex-col items-center gap-5 rounded-3xl bg-zinc-900 p-6 text-center short:gap-3 short:p-4"
	aria-live="polite"
>
	<audio bind:this={audio} autoplay></audio>
	<div
		class="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-700 text-5xl font-bold text-white short:h-14 short:w-14 short:text-3xl"
		aria-hidden="true"
	>
		{phone.otherName.slice(0, 1).toUpperCase()}
	</div>
	<div>
		<p class="text-3xl font-bold">{phone.otherName}</p>
		<p class={['text-2xl tabular-nums', phone.busy ? 'text-emerald-400' : 'text-zinc-400']}>
			{status}
		</p>
	</div>
	{#if phone.problem}
		<p class="rounded-xl bg-amber-950 p-3 text-lg text-amber-200">{phone.problem}</p>
	{/if}
	{#if blocked}
		<button
			class="rounded-xl bg-amber-500 px-5 py-3 text-xl font-semibold text-black"
			onclick={() => audio?.play().then(() => (blocked = false))}>Toca para oír</button
		>
	{/if}

	<div class="flex items-center justify-center gap-8">
		{#if phone.state === 'incoming'}
			<button class="{round} bg-red-600" aria-label="Rechazar" onclick={() => phone.reject()}>
				{@render handset('h-12 w-12 rotate-[135deg]')}
			</button>
			<button class="{round} bg-green-600" aria-label="Contestar" onclick={() => phone.answer()}>
				{@render handset('h-12 w-12')}
			</button>
		{:else if phone.busy}
			<button
				class={[
					round,
					phone.muted ? 'bg-zinc-100 text-zinc-950!' : 'bg-zinc-700',
					'h-20! w-20! short:h-14! short:w-14!'
				]}
				aria-label={phone.muted ? 'Activar el micrófono' : 'Silenciar el micrófono'}
				aria-pressed={phone.muted}
				onclick={() => phone.toggleMute()}
			>
				<svg viewBox="0 0 24 24" class="h-10 w-10" fill="currentColor" aria-hidden="true">
					<rect x="9" y="2.5" width="6" height="12" rx="3" />
					<path
						d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/>
					{#if phone.muted}
						<path d="M4 3l16 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
					{/if}
				</svg>
			</button>
			<button class="{round} bg-red-600" aria-label="Colgar" onclick={() => phone.hangup()}>
				{@render handset('h-12 w-12 rotate-[135deg]')}
			</button>
		{:else}
			<button
				class="rounded-2xl bg-zinc-800 px-8 py-4 text-2xl font-semibold active:scale-95"
				onclick={() => {
					phone.reset();
					onclose?.();
				}}>Cerrar</button
			>
		{/if}
	</div>
</section>

<!-- A handset; turned down, hanging up. -->
{#snippet handset(size: string)}
	<svg viewBox="0 0 24 24" class={size} fill="currentColor" aria-hidden="true">
		<path
			d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"
		/>
	</svg>
{/snippet}

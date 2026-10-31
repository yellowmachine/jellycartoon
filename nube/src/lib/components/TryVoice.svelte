<script lang="ts">
	import { onDestroy } from 'svelte';
	import { music } from 'comun/music-player.svelte.ts';
	import { secondary } from '#lib/styles.ts';

	/**
	 * Oración's voice tried (#339): a few lines read now with this voice and tone, not kept, to hear
	 * it before recording a long text. What plays pauses meanwhile, and goes on after.
	 */
	let {
		voice,
		tone,
		text,
		label = '▶ Probar'
	}: { voice: string; tone: string; text: string; label?: string } = $props();

	let step = $state<'idle' | 'asking' | 'playing'>('idle');
	let problem = $state<string | null>(null);
	// In the page, not `new Audio()`: an extension like Plasma Browser Integration replays a detached
	// one itself, and the page's play() is then refused (AbortError) although it sounds.
	let audio = $state<HTMLAudioElement>();
	let url: string | null = null;

	function stop() {
		audio?.pause();
		audio?.removeAttribute('src');
		if (url) URL.revokeObjectURL(url);
		url = null;
		if (step === 'playing') music.resumeAfterVoice();
		step = 'idle';
	}

	async function play() {
		if (step !== 'idle') return stop();
		problem = null;
		step = 'asking';
		const res = await fetch('/api/oracion/probar', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ voice, tone, text })
		}).catch(() => null);
		if (step !== 'asking') return;
		if (!res?.ok) {
			problem =
				(await res?.json().catch(() => null))?.message ??
				(res ? 'No se pudo probar la voz.' : 'Sin conexión.');
			step = 'idle';
			return;
		}
		if (!audio) return;
		url = URL.createObjectURL(await res.blob());
		audio.src = url;
		music.pauseForVoice();
		step = 'playing';
		await audio.play().catch(() => {
			problem = 'El navegador no la deja sonar.';
			stop();
		});
	}

	onDestroy(stop);
</script>

<span class="inline-flex flex-wrap items-center gap-2">
	<button type="button" class={secondary} disabled={!text.trim()} onclick={play}
		>{step === 'asking' ? 'Generando la prueba…' : step === 'playing' ? '■ Parar' : label}</button
	>
	<audio bind:this={audio} onended={stop} hidden></audio>
	{#if problem}<span class="text-sm text-red-400">{problem}</span>{/if}
</span>

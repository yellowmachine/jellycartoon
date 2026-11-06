<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import jsQR from 'jsqr';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/**
	 * «Leer un QR»: the camera, until it sees the QR on a child's device («¿Quién eres?», #303),
	 * which opens its request to answer (/peques/permiso/…), or on the house's TV, which opens there
	 * /entrar to let this adult in (#172) or /peques/permiso/… to let a child in (#279), with «Entrar
	 * con Seilide» if the phone has no session of the house yet. Only those links: any other QR is said, not followed. Read here with
	 * jsQR, frame by frame, on every browser.
	 */
	let video = $state<HTMLVideoElement>();
	let problem = $state<string | null>(null);
	let wrong = $state(false);

	const REQUEST_PATH = /^\/peques\/permiso\/[\w-]+$/;

	/** Where to go for what was read: a child's request here, or the house's TV; null, neither. */
	function target(text: string): { here: string } | { house: string } | null {
		let url: URL;
		try {
			url = new URL(text);
		} catch {
			return null;
		}
		if (data.guardian && url.origin === location.origin && REQUEST_PATH.test(url.pathname))
			return { here: url.pathname };
		if (
			data.houseOrigin &&
			url.origin === data.houseOrigin &&
			((url.pathname === '/entrar' && url.searchParams.get('codigo')) ||
				REQUEST_PATH.test(url.pathname))
		)
			return { house: url.href };
		return null;
	}

	/** What it reads, said over the camera. */
	const what = $derived(
		[
			data.houseOrigin && 'el de la tele, al elegir un dibujo',
			data.guardian && 'el del aparato de un peque, al elegir el suyo'
		]
			.filter(Boolean)
			.join(', o ')
	);

	onMount(() => {
		let stream: MediaStream | null = null;
		let frame = 0;
		let stopped = false;
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d', { willReadFrequently: true });

		function look() {
			if (stopped || !video || !context) return;
			if (video.readyState >= video.HAVE_ENOUGH_DATA) {
				canvas.width = video.videoWidth;
				canvas.height = video.videoHeight;
				context.drawImage(video, 0, 0);
				const image = context.getImageData(0, 0, canvas.width, canvas.height);
				const found = jsQR(image.data, image.width, image.height, {
					inversionAttempts: 'dontInvert'
				});
				if (found) {
					const to = target(found.data);
					if (to) {
						stopped = true;
						if ('here' in to) void goto(to.here);
						// The house's app: the whole page goes there.
						else location.assign(to.house);
						return;
					}
					wrong = true;
				}
			}
			frame = requestAnimationFrame(look);
		}

		(async () => {
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: 'environment' },
					audio: false
				});
				if (stopped || !video) return stream.getTracks().forEach((t) => t.stop());
				video.srcObject = stream;
				await video.play();
				frame = requestAnimationFrame(look);
			} catch {
				problem =
					'No se puede abrir la cámara. Dale permiso en el navegador, o lee el QR con la cámara del móvil.';
			}
		})();

		return () => {
			stopped = true;
			cancelAnimationFrame(frame);
			stream?.getTracks().forEach((t) => t.stop());
		};
	});
</script>

<svelte:head>
	<title>Leer un QR · Seilide</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col items-center gap-4 pt-6 text-center">
	<h1 class="text-2xl font-bold">Leer un QR</h1>
	{#if what}
		<p class="text-sm text-zinc-400">Apunta al QR: {what}.</p>
	{/if}
	{#if data.hasHouse && !data.houseOrigin}
		<p class="text-sm text-amber-400">
			Para leer el de la tele, pon la dirección de jellycartoon en
			<a href="/ajustes?seccion=conexiones#casa" class="underline">Ajustes → Conexiones → Tu casa</a
			>.
		</p>
	{/if}
	{#if problem}
		<p class="text-red-400">{problem}</p>
	{:else}
		<video
			bind:this={video}
			playsinline
			muted
			class="aspect-square w-full max-w-sm rounded-xl bg-zinc-900 object-cover"
		></video>
		{#if wrong}
			<p class="text-sm text-amber-400">Ese QR no es de la tele ni de un peque de Seilide.</p>
		{/if}
	{/if}
	<a href="/" class="text-zinc-400 hover:text-white">Cancelar</a>
</div>

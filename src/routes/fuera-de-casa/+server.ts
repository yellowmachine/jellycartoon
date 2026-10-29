import type { RequestHandler } from './$types';
import { NUBE_URL } from '$app/env/private';
import { cloudUrl } from '#lib/server/kitchen.ts';
// The cloud's drawing (#253): the house with its wifi behind, the snail off to the cloud.
import drawing from 'comun/dibujos/fuera-de-casa.svg?raw';

/**
 * The page the app shows when the house does not answer (src/service-worker): out of its wifi
 * without the VPN, or its server off. The service worker keeps it on installing, so it shows
 * without the house; from there, the cloud, and back by itself as soon as the house answers.
 * Public: it says nothing but where the family's cloud is.
 */

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const GET: RequestHandler = async () => {
	const cloud = (await cloudUrl()) ?? NUBE_URL ?? null;
	const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#09090b">
<title>Fuera de casa · JellyCartoon</title>
<style>
	body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
		background: #09090b; color: #a1a1aa; font-family: system-ui, sans-serif; text-align: center;
		padding: 16px; box-sizing: border-box; }
	main { max-width: 26rem; }
	.drawing { max-width: 18rem; margin: 0 auto; color: #f4f4f5; }
	.drawing svg { display: block; width: 100%; }
	h1 { color: #fbbf24; font-size: 1.5rem; margin: 1rem 0 .5rem; }
	p { margin: 0 0 1rem; line-height: 1.5; }
	.links { display: flex; flex-wrap: wrap; gap: .5rem; justify-content: center; margin-top: 1.5rem; }
	a, button { font: inherit; font-size: .95rem; border-radius: .375rem; padding: .6rem 1rem;
		cursor: pointer; text-decoration: none; border: 0; }
	.main { background: #f59e0b; color: #09090b; font-weight: 600; }
	.other { background: #27272a; color: #e4e4e7; }
	small { display: block; margin-top: 1.5rem; font-size: .8rem; color: #71717a; }
</style>
</head>
<body>
<main>
	<div class="drawing">${drawing}</div>
	<h1>Estás fuera de casa</h1>
	<p>JellyCartoon solo se abre en la wifi de casa o con la VPN (WireGuard) encendida.</p>
	${cloud ? '<p>Fuera, lo tuyo está en la nube: series, música, la agenda, los gastos…</p>' : ''}
	<div class="links">
		${cloud ? `<a class="main" href="${escape(cloud)}">Ir a la nube</a>` : ''}
		<button class="${cloud ? 'other' : 'main'}" onclick="location.reload()">Reintentar</button>
	</div>
	<small>Si estás en casa, puede que el servidor esté apagado o reiniciándose. Esta página vuelve
		sola en cuanto conteste.</small>
</main>
<script>
	// Back by itself as soon as the house answers (any answer: it is reachable).
	setInterval(async () => {
		try {
			await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
			location.reload();
		} catch {}
	}, 5000);
</script>
</body>
</html>`;
	return new Response(html, {
		headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
	});
};

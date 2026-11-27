import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { PlugTask, PlugTaskResult } from '../../packages/comun/src/voice.ts';
import { isHomeIp, RELAY_PORT } from './plugs.ts';
import { ANY_PLUG, type Trust } from './trust.ts';

/**
 * Giving a device to the satellite (#643, phase 2): «añade un aparato», said to it, opens the
 * window for five minutes; its page in the home's wifi (`http://<satellite>:8790/alta`) shows the
 * code, which is copied and pasted in Seilide on that same device. Only an order the satellite has
 * just heard itself opens it: Seilide alone cannot. The code never goes to Seilide; what does, the
 * device's key with a MAC made with it, is of no use without it.
 */

/** «Añade un aparato» counts only this soon after the satellite itself sent an order. */
export const HEARD_MS = 60_000;

/**
 * Its own password, `ALTA_CLAVE` in its .env, as the other way to open the window from its page.
 * Not SATELLITE_KEY: that one goes to Seilide with every request. After this many wrong ones, none
 * is tried for a while, so that it cannot be guessed.
 */
const MAX_WRONG = 5;
const LOCKED_MS = 15 * 60_000;

export function passwordGate(password: string | null, now: () => number = Date.now) {
	const want = password ? createHash('sha256').update(password).digest() : null;
	let wrong: number[] = [];
	return {
		on: want !== null,
		/** True if it is the password; null if trying is locked now. */
		try(given: string) {
			if (!want) return false;
			const at = now();
			wrong = wrong.filter((t) => t > at - LOCKED_MS);
			if (wrong.length >= MAX_WRONG) return null;
			const ok = timingSafeEqual(createHash('sha256').update(given).digest(), want);
			if (!ok) wrong.push(at);
			return ok;
		}
	};
}

export type PasswordGate = ReturnType<typeof passwordGate>;

/** Its address in the home's network, for the page's link: the first home IPv4 that is not Docker's. */
export function homeAddress(interfaces = networkInterfaces()) {
	for (const [name, list] of Object.entries(interfaces)) {
		if (/^(docker|br-|veth|virbr)/.test(name)) continue;
		for (const net of list ?? [])
			if (net.family === 'IPv4' && !net.internal && isHomeIp(net.address)) return net.address;
	}
	return null;
}

export const pageAddress = (ip: string, port = RELAY_PORT) => `http://${ip}:${port}/alta`;

/** «abrir-alta» and «alta», from Seilide: null if the task is not one of them. */
export function doEnrolTask(
	task: PlugTask,
	trust: Trust,
	heardAgo: () => number,
	address: () => string | null = homeAddress
): PlugTaskResult | null {
	if (task.kind === 'abrir-alta') {
		if (heardAgo() > HEARD_MS)
			return { id: task.id, problem: 'Solo se abre diciéndoselo al satélite' };
		const w = trust.openEnrolment();
		const ip = address();
		return { id: task.id, url: ip ? pageAddress(ip) : undefined, until: w.until };
	}
	if (task.kind === 'alta') {
		const done = trust.enrol(task.publicKey, task.name, task.mac);
		if (!done.ok) return { id: task.id, problem: done.why };
		return { id: task.id, enrolled: { fp: done.fp, satellite: done.satellite, ack: done.ack } };
	}
	if (task.kind === 'olvidar') {
		// Only the device itself: its own signature, and it is the one that leaves.
		const signed = trust.check(task.envelope, task.sig, ANY_PLUG);
		if (!signed.ok) return { id: task.id, problem: signed.why };
		if (signed.method !== 'Satelite.Olvidar') return { id: task.id, problem: 'no se firma eso' };
		trust.leave(signed.fp);
		return { id: task.id, forgotten: true };
	}
	return null;
}

const escape = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
	);

const clock = new Intl.DateTimeFormat('es-ES', {
	hour: '2-digit',
	minute: '2-digit',
	timeZone: process.env.TZ || 'Europe/Madrid'
});

export function pageHtml(trust: Trust, gate?: PasswordGate, problem?: string) {
	const w = trust.enrolment();
	const devices = trust.devices();
	const list = devices.length
		? `<ul>${devices
				.map(
					(d) =>
						`<li><span>${escape(d.name)} <small>${escape(d.fp.slice(0, 8))}</small></span>${
							w
								? `<form method="post" action="/alta/quitar"><input type="hidden" name="fp" value="${escape(d.fp)}"><button>Quitar</button></form>`
								: ''
						}</li>`
				)
				.join('')}</ul>`
		: '<p>Ninguno todavía.</p>';
	const body = w
		? `<h1>Dar de alta un aparato</h1>
<p>En <b>este mismo aparato</b>, copia el código, abre Seilide → <b>Enchufes</b> → «Dar de alta este aparato» y pégalo.</p>
<textarea id="code" readonly rows="2">${escape(trust.code(w))}</textarea>
<button id="copy" type="button">Copiar</button> <span id="done"></span>
<p class="muted">Sirve una vez, hasta las ${clock.format(new Date(w.until))}.</p>`
		: `<h1>El alta está cerrada</h1>
<p>Di <b>«añade un aparato»</b> al satélite y vuelve a cargar esta página.</p>${
				gate?.on
					? `<form method="post" action="/alta/abrir"><p>O ábrela con la clave del satélite (<code>ALTA_CLAVE</code> en su <code>.env</code>):</p>
<input type="password" name="clave" autocomplete="current-password" required> <button>Abrir</button></form>`
					: ''
			}${problem ? `<p class="bad">${escape(problem)}</p>` : ''}`;
	return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Satélite: aparatos</title>
<style>
body{font-family:system-ui,sans-serif;background:#09090b;color:#e4e4e7;max-width:34rem;margin:2rem auto;padding:0 1rem;line-height:1.5}
h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem}b{color:#fbbf24}.muted,small{color:#a1a1aa}
textarea{width:100%;box-sizing:border-box;font:1rem ui-monospace,monospace;background:#18181b;color:#fff;border:1px solid #3f3f46;border-radius:.5rem;padding:.6rem}
button{background:#f59e0b;color:#09090b;border:0;border-radius:.5rem;padding:.5rem 1rem;font-weight:600}
ul{padding:0;list-style:none}li{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #27272a;padding:.5rem 0}
li button{background:#27272a;color:#e4e4e7}.bad{color:#fca5a5}
input[type=password]{font:1rem system-ui;background:#18181b;color:#fff;border:1px solid #3f3f46;border-radius:.5rem;padding:.5rem}
</style></head><body>
${body}
<h2>Aparatos dados de alta</h2>
${list}
<p class="muted">Huella del satélite: ${escape(trust.fp)}</p>
<script>
const b=document.getElementById('copy');
if(b)b.onclick=async()=>{const t=document.getElementById('code');t.select();
try{await navigator.clipboard.writeText(t.value)}catch{document.execCommand('copy')}
document.getElementById('done').textContent='✓ Copiado'};
</script>
</body></html>`;
}

/** What a form sends, as text: at most a little. */
function formOf(req: IncomingMessage, done: (form: URLSearchParams) => void) {
	let body = '';
	req.on('data', (chunk) => {
		body += chunk;
		if (body.length > 1000) req.destroy();
	});
	req.on('end', () => done(new URLSearchParams(body)));
}

/**
 * Its page (`/alta`); opening the window with its password, if it has one; and removing a device
 * while the window is open.
 */
export function altaPage(trust: Trust, gate: PasswordGate = passwordGate(null)) {
	return (req: IncomingMessage, res: ServerResponse) => {
		const path = (req.url ?? '').split('?')[0];
		const headers = {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store',
			'x-frame-options': 'DENY',
			'content-security-policy':
				"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'"
		};
		if (req.method === 'GET' && path === '/alta') {
			res.writeHead(200, headers).end(pageHtml(trust, gate));
			return true;
		}
		if (req.method !== 'POST' || (path !== '/alta/quitar' && path !== '/alta/abrir')) return false;
		// Only from its own page: another site cannot make the browser do it.
		const origin = req.headers.origin;
		if (origin && origin !== `http://${req.headers.host}`) {
			res.writeHead(403).end();
			return true;
		}
		formOf(req, (form) => {
			if (path === '/alta/abrir') {
				const ok = gate.try(form.get('clave') ?? '');
				if (ok) {
					trust.openEnrolment();
					return res.writeHead(303, { location: '/alta' }).end();
				}
				const problem =
					ok === null ? 'Demasiados intentos: espera un cuarto de hora' : 'Esa clave no es';
				return res.writeHead(403, headers).end(pageHtml(trust, gate, problem));
			}
			const fp = form.get('fp');
			if (fp) trust.remove(fp);
			res.writeHead(303, { location: '/alta' }).end();
		});
		return true;
		return false;
	};
}

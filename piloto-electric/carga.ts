/**
 * Muchas familias (#394, fase 5), para medir: `tablas` tablas de prueba y `familias` familias, y un
 * shape en vivo por cada par, directo a Electric. Solo mide: bun carga.ts <tablas> <familias> <segundos>.
 */
import postgres from 'postgres';

const [tablas, familias, segundos] = process.argv.slice(2).map(Number);
const FILAS = 200;
const E = 'http://127.0.0.1:5441/v1/shape';
const sql = postgres('postgres://nube:nube@127.0.0.1:5440/nube', { max: 4, onnotice: () => {} });
const nombre = (t: number) => `carga_${t}`;
const fam = (f: number) => `carga-${f}`;

for (let t = 0; t < tablas; t++) {
	const n = nombre(t);
	await sql.unsafe(
		`create table ${n} (id serial primary key, family_id text not null, dato text not null)`
	);
	await sql.unsafe(`create index on ${n} (family_id)`);
	await sql.unsafe(`alter table ${n} replica identity full`);
	await sql.unsafe(`alter publication electric_publication_default add table ${n}`);
	await sql.unsafe(`grant select on ${n} to electric`);
	await sql.unsafe(`insert into ${n} (family_id, dato)
		select 'carga-' || f, repeat('x', 100) from generate_series(0, ${familias - 1}) f, generate_series(1, ${FILAS})`);
}

const parar = new AbortController();
let errores = 0;
const estados: Record<number, number> = {};
let ultimo = '';
const espera: Record<string, (ms: number) => void> = {};

async function seguir(t: number, f: number, listo: () => void) {
	const url = (extra: string) =>
		`${E}?table=${nombre(t)}&where=family_id%3D%241&params%5B1%5D=${fam(f)}&secret=piloto-secreto&${extra}`;
	let offset = '-1';
	let handle = '';
	let enVivo = false;
	while (!parar.signal.aborted) {
		try {
			const res = await fetch(
				url(`offset=${offset}${handle ? `&handle=${handle}` : ''}${enVivo ? '&live=true' : ''}`),
				{ signal: parar.signal }
			);
			if (!res.ok) {
				errores++;
				estados[res.status] = (estados[res.status] ?? 0) + 1;
				ultimo = (await res.text()).slice(0, 160);
				// Un shape caducado: como manda el protocolo, desde el principio.
				if (res.status === 409) {
					offset = '-1';
					handle = '';
					enVivo = false;
					continue;
				}
				await new Promise((r) => setTimeout(r, 1000));
				continue;
			}
			const mensajes = (await res.json()) as { value?: { dato?: string } }[];
			offset = res.headers.get('electric-offset') ?? offset;
			handle = res.headers.get('electric-handle') ?? handle;
			if (res.headers.has('electric-up-to-date') && !enVivo) {
				enVivo = true;
				listo();
			}
			for (const m of mensajes)
				if (m.value?.dato?.startsWith('t:')) {
					espera[`${t}/${f}`]?.(Date.now() - Number(m.value.dato.slice(2)));
				}
		} catch {
			if (!parar.signal.aborted) errores++;
		}
	}
}

const t0 = Date.now();
let abiertos = 0;
const progreso = setInterval(
	() =>
		console.log(
			`  ${((Date.now() - t0) / 1000).toFixed(0)} s: ${abiertos} al día, errores ${errores} ${JSON.stringify(estados)} ${ultimo}`
		),
	15000
);
const todos: Promise<void>[] = [];
await new Promise<void>((resolve) => {
	const total = tablas * familias;
	for (let t = 0; t < tablas; t++)
		for (let f = 0; f < familias; f++)
			todos.push(seguir(t, f, () => ++abiertos === total && resolve()));
});
clearInterval(progreso);
console.log(
	`${tablas * familias} shapes al día en ${((Date.now() - t0) / 1000).toFixed(1)} s, errores ${errores}`
);

// Un cambio de vez en cuando en una familia al azar: lo que tarda en llegarle a su shape.
const tiempos: number[] = [];
const fin = Date.now() + segundos * 1000;
while (Date.now() < fin) {
	const t = Math.floor(Math.random() * tablas);
	const f = Math.floor(Math.random() * familias);
	const llegó = new Promise<void>((resolve) => {
		espera[`${t}/${f}`] = (ms) => {
			tiempos.push(ms);
			resolve();
		};
		setTimeout(resolve, 5000);
	});
	await sql.unsafe(
		`insert into ${nombre(t)} (family_id, dato) values ('${fam(f)}', 't:${Date.now()}')`
	);
	await llegó;
	await new Promise((r) => setTimeout(r, 100));
}
tiempos.sort((a, b) => a - b);
console.log(
	`cambios: ${tiempos.length} · mediana ${tiempos[tiempos.length >> 1]} ms · p95 ${tiempos[Math.floor(tiempos.length * 0.95)]} ms · máx ${tiempos[tiempos.length - 1]} ms · errores ${errores}`
);
parar.abort();
await Promise.allSettled(todos);
await sql.end();
process.exit(0);

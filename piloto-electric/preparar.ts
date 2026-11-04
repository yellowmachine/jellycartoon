/**
 * Dos familias con su llave en Seilide, y la casa del piloto conectada con la de la familia A (#394).
 * Las llaves, en .datos/llaves.env. Se puede repetir: da llaves nuevas.
 */
import { createCipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';

const seilide = postgres('postgres://nube:nube@127.0.0.1:5440/nube', { max: 1 });
const casa = postgres('postgres://jellycartoon:jellycartoon@127.0.0.1:5442/jellycartoon', {
	max: 1
});

const [{ id: a }] = await seilide`select id from family where name = 'Familia A'`;
await seilide`insert into family (id, name) values ('fam-b', 'Familia B') on conflict do nothing`;

async function llave(familyId: string) {
	const key = `nube_${randomBytes(32).toString('base64url')}`;
	await seilide`insert into house_key (id, family_id, name, hash, start) values
		(${randomBytes(8).toString('hex')}, ${familyId}, 'piloto',
		 ${createHash('sha256').update(key).digest('hex')}, ${key.slice(0, 11)})`;
	return key;
}
const keyA = await llave(a);
const keyB = await llave('fam-b');

// Como secret-box.ts de la casa, con el BETTER_AUTH_SECRET de arrancar.sh.
const secret = Buffer.from(
	hkdfSync('sha256', 'piloto-casa-secreto-de-pruebas-32', 'jellycartoon', 'kid credential', 32)
);
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', secret, iv);
const data = Buffer.concat([cipher.update(keyA, 'utf8'), cipher.final()]);
const sealed = [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');

for (const [key, value] of [
	['nube_url', 'http://127.0.0.1:3470'],
	['nube_key', sealed]
])
	await casa`insert into app_setting (key, value, updated_at) values (${key}, ${value}, now())
		on conflict (key) do update set value = excluded.value, updated_at = now()`;

writeFileSync(
	`${import.meta.dir}/.datos/llaves.env`,
	`FAMILIA_A=${a}\nLLAVE_A=${keyA}\nLLAVE_B=${keyB}\n`
);

await seilide.end();
await casa.end();
console.log('Llaves en .datos/llaves.env');

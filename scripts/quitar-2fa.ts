/**
 * Turns off an account's second step (the code from the app), for whoever lost both the app and
 * its recovery codes: `docker compose -f compose.prod.yaml exec app bun run quitar-2fa <email>`.
 * Only who can get into the server can run it. The administrator is asked to set it up again on
 * their next sign-in.
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
	console.error('Uso: bun run quitar-2fa <email de la cuenta>');
	process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
	const [found] = await sql<{ id: string }[]>`select id from "user" where lower(email) = ${email}`;
	if (!found) {
		console.error(`No hay ninguna cuenta con el email ${email}`);
		process.exitCode = 1;
	} else {
		await sql.begin(async (tx) => {
			await tx`delete from two_factor where user_id = ${found.id}`;
			await tx`update "user" set two_factor_enabled = false where id = ${found.id}`;
			// Its trusted devices too: whoever has one of them would not be asked for anything.
			await tx`delete from verification where value = ${found.id} and identifier like 'trust-device-%'`;
		});
		console.log(`Verificación en dos pasos quitada a ${email}: ya entra solo con la contraseña.`);
	}
} finally {
	await sql.end();
}

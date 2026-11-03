import { eq } from 'drizzle-orm';
import { admin } from './admin.ts';
import { familySettings, house, kidAccount, telegramBot } from './db/schema.ts';
import { asFamily } from './family.ts';
import { checkKms, kmsOn, openFor, sealFor, sealedNow } from './family-secret.ts';

/**
 * With the KMS just on (#326): every family's secrets kept before it (secret-box.ts's), read and
 * kept again with the family's data key (family-secret.ts), at the server's start, once Key
 * Manager has been seen to wrap and unwrap a key made for that alone. Those already
 * kept with it are left as they are, so starting again does nothing more. One that cannot be read
 * stays as it was, said in the log. Never fails.
 */
export async function migrateToKms() {
	if (!kmsOn) return;
	// First, that Key Manager answers as it should: else nothing is kept with it.
	const problem = await checkKms();
	if (problem) {
		console.error(`[kms] Key Manager no funciona como debe, no se pasa nada: ${problem}`);
		return;
	}
	console.info('[kms] Key Manager responde: envuelve y desenvuelve bien');
	let moved = 0;
	try {
		for (const familyId of await admin.familyIds()) moved += await migrateFamily(familyId);
		if (moved) console.info(`[kms] ${moved} secretos guardados ya con el KMS`);
	} catch (err) {
		console.error('[kms] No se pudieron pasar los secretos al KMS', String(err));
	}
}

/** What is to be kept again, read; null if it is already as it should be, or cannot be read. */
async function again(familyId: string, value: string | null) {
	if (!value || sealedNow(value)) return null;
	const text = await openFor(familyId, value);
	if (text === null) {
		console.error('[kms] Un secreto que no se puede leer: se queda como estaba', { familyId });
		return null;
	}
	return sealFor(familyId, text);
}

async function migrateFamily(familyId: string) {
	const [settings, home, bot, kids] = await asFamily(familyId, (tx) =>
		Promise.all([
			tx
				.select({ openrouterKey: familySettings.openrouterKey, orsKey: familySettings.orsKey })
				.from(familySettings),
			tx.select({ key: house.key }).from(house),
			tx.select({ token: telegramBot.token }).from(telegramBot),
			tx.select({ userId: kidAccount.userId, secret: kidAccount.secret }).from(kidAccount)
		])
	);
	// Read and kept again outside the transaction (the KMS may take asking); written in one.
	const openrouterKey = await again(familyId, settings[0]?.openrouterKey ?? null);
	const orsKey = await again(familyId, settings[0]?.orsKey ?? null);
	const houseKey = await again(familyId, home[0]?.key ?? null);
	const token = await again(familyId, bot[0]?.token ?? null);
	const kidSecrets: { userId: string; secret: string }[] = [];
	for (const kid of kids) {
		const secret = await again(familyId, kid.secret);
		if (secret) kidSecrets.push({ userId: kid.userId, secret });
	}
	await asFamily(familyId, async (tx) => {
		if (openrouterKey) await tx.update(familySettings).set({ openrouterKey });
		if (orsKey) await tx.update(familySettings).set({ orsKey });
		if (houseKey) await tx.update(house).set({ key: houseKey });
		if (token) await tx.update(telegramBot).set({ token });
		for (const kid of kidSecrets)
			await tx
				.update(kidAccount)
				.set({ secret: kid.secret })
				.where(eq(kidAccount.userId, kid.userId));
	});
	return [openrouterKey, orsKey, houseKey, token].filter(Boolean).length + kidSecrets.length;
}

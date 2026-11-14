import { BUNQ_SANDBOX, ORIGIN } from '$app/env/private';
import { db } from '../db/index.ts';
import { boughtOf } from '../expenses/bought.ts';
import { addExpense } from '../expenses/expenses.ts';
import { ruleEvent } from '../rule-events.ts';
import { familyMember } from '../db/schema.ts';
import { asFamily, asUser } from '../family.ts';
import { dayOf, kitchenOf, today } from '../fridge.ts';
import { secretsOfUser } from '../user-secret.ts';
import { bankKeyScope } from './bank-key-scope.ts';
import { BUNQ_API, BUNQ_SANDBOX_API, bunqClient } from './bunq-api.ts';
import { bunqBank } from './bunq.ts';

/** Each adult's bunq (bunq.ts), with the app's database, secrets and Dinero. */

/** What all of Seilide's addresses for bunq start with. */
const HOOK_PREFIX = `${ORIGIN.replace(/\/+$/, '')}/api/bancos/bunq/`;

export const sandbox = BUNQ_SANDBOX;

export const bank = bunqBank({
	asUser,
	secrets: secretsOfUser,
	kitchenOf,
	client: (onSession) =>
		bunqClient({ base: BUNQ_SANDBOX ? BUNQ_SANDBOX_API : BUNQ_API, onSession }),
	// bunq calls only https addresses: in development, only the hourly look and «Traer ahora».
	hookUrl: (token) => (HOOK_PREFIX.startsWith('https://') ? `${HOOK_PREFIX}${token}` : null),
	hookPrefix: HOOK_PREFIX,
	addExpense: async (k, input, userId, live) => {
		const id = await addExpense(k, input, 'banco', null, null, null, userId);
		// A payment just made, as a receipt saved (#451): «compra en Mercadona» goes off now.
		if (live) ruleEvent(k, 'compra', input.store, userId, [], boughtOf(id, input));
		return id;
	},
	today,
	dayOf
});

export const userOfHook = bankKeyScope(db);

/**
 * Whether a call comes from bunq: its addresses, 185.40.108.0/22, in production; in the sandbox,
 * any (they come from AWS). The call only says that something happened: the payments are asked
 * for with the session, so this only keeps others' calls from making Seilide ask.
 */
export function fromBunq(ip: string) {
	if (BUNQ_SANDBOX) return true;
	const parts = ip
		.replace(/^::ffff:/, '')
		.split('.')
		.map(Number);
	if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
		return false;
	return parts[0] === 185 && parts[1] === 40 && parts[2]! >= 108 && parts[2]! <= 111;
}

/** Every hour (scheduler.ts): each of the family's people with a bank, what bunq's calls missed. */
export async function syncFamily(familyId: string) {
	const members = await asFamily(familyId, (tx) =>
		tx.select({ userId: familyMember.userId }).from(familyMember)
	);
	await bank.syncAll(members.flatMap((m) => (m.userId ? [m.userId] : [])));
}

/**
 * The failed logins of `/rest` (#625), an open door to the Internet, counted in memory: with too
 * many of them in a while, no more are looked at. By address and by address and account together,
 * never by account alone: whoever knows an email could then leave its owner without music. The
 * passwords, made by Seilide (20 characters), are not for guessing; this is so that trying costs
 * nothing here (the database, the KMS).
 */
export const WINDOW_MS = 15 * 60_000;
/** A phone with the old password asks a lot at once, and only locks itself. */
export const MAX_PER_ACCOUNT = 20;
export const MAX_PER_ADDRESS = 100;
/** The most kept: past it, the oldest go. */
const MAX_KEPT = 10_000;

export function attempts(now: () => number = Date.now) {
	const failures = new Map<string, { since: number; n: number }>();
	const keysOf = (ip: string, account: string) => [
		{ key: `ip ${ip}`, max: MAX_PER_ADDRESS },
		// An account as long as one likes is not kept.
		{ key: `cuenta ${ip} ${account.slice(0, 100)}`, max: MAX_PER_ACCOUNT }
	];
	const count = (key: string) => {
		const f = failures.get(key);
		if (!f) return 0;
		if (now() - f.since < WINDOW_MS) return f.n;
		failures.delete(key);
		return 0;
	};
	return {
		blocked: (ip: string, account: string) =>
			keysOf(ip, account).some(({ key, max }) => count(key) >= max),
		failed(ip: string, account: string) {
			for (const { key } of keysOf(ip, account)) {
				const n = count(key);
				if (n) failures.get(key)!.n = n + 1;
				else {
					if (failures.size >= MAX_KEPT) failures.delete(failures.keys().next().value!);
					failures.set(key, { since: now(), n: 1 });
				}
			}
		}
	};
}

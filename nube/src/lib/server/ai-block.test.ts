import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import {
	AiBlocked,
	BAD_KEY,
	blockOf,
	forgetBlocks,
	guarded,
	NO_CREDIT,
	refusalWords,
	rememberBlock,
	SHORT_CREDIT,
	TOO_MANY,
	unblock,
	watchBlocks,
	type Block
} from './ai-block.ts';

/** OpenRouter's no, as it sends it. */
const no = (status: number, message: string) =>
	new Response(JSON.stringify({ error: { message, code: status } }), { status });
const ok = () => Response.json({ choices: [] });
const NO_MONEY = 'Insufficient credits. Add more using https://openrouter.ai/settings/credits';
const IN_FLIGHT =
	'This request would exceed your available credits given your current in-flight requests';

afterEach(() => {
	forgetBlocks();
	setSystemTime();
});

describe('refusalWords', () => {
	test('tells the 402s apart', () => {
		expect(refusalWords(402, IN_FLIGHT)).toBe(TOO_MANY);
		expect(refusalWords(402, "This request's maximum cost exceeds your available credits")).toBe(
			SHORT_CREDIT
		);
		expect(refusalWords(402, NO_MONEY)).toBe(NO_CREDIT);
		expect(refusalWords(401, 'User not found')).toBe(BAD_KEY);
		expect(refusalWords(500, 'boom')).toBeNull();
		// Ours already (a stopped family's, to an app): as it is.
		expect(refusalWords(402, SHORT_CREDIT)).toBe(SHORT_CREDIT);
	});
});

describe('guarded', () => {
	test('stops at the third no credit in ten minutes, without sending, and tells', async () => {
		const told: (Block | null)[] = [];
		const stop = watchBlocks((key, block) => key === 'k1' && told.push(block));
		let sent = 0;
		const send = async () => (sent++, no(402, NO_MONEY));
		for (let i = 0; i < 3; i++) expect((await guarded('k1', send)).status).toBe(402);
		expect(blockOf('k1')?.why).toBe(NO_CREDIT);
		expect(told).toHaveLength(1);
		await expect(guarded('k1', send)).rejects.toBeInstanceOf(AiBlocked);
		expect(sent).toBe(3);
		// Another family's key goes on.
		expect((await guarded('k2', async () => ok())).ok).toBe(true);
		stop();
	});

	test('nos further apart than ten minutes, or with a yes between, do not stop it', async () => {
		const send = async () => no(402, NO_MONEY);
		setSystemTime(new Date('2026-11-01T10:00:00Z'));
		await guarded('k1', send);
		await guarded('k1', send);
		setSystemTime(new Date('2026-11-01T10:11:00Z'));
		await guarded('k1', send);
		expect(blockOf('k1')).toBeNull();
		await guarded('k1', async () => ok());
		await guarded('k1', send);
		await guarded('k1', send);
		expect(blockOf('k1')).toBeNull();
	});

	test('a key refused stops it at once', async () => {
		await guarded('k1', async () => no(401, 'User not found'));
		expect(blockOf('k1')?.why).toBe(BAD_KEY);
	});

	test('too many at once: asked again once, and never counted', async () => {
		const answers = [no(402, IN_FLIGHT), ok()];
		const res = await guarded('k1', async () => answers.shift()!);
		expect(res.ok).toBe(true);
		for (let i = 0; i < 3; i++) await guarded('k1', async () => no(402, IN_FLIGHT));
		expect(blockOf('k1')).toBeNull();
	}, 30_000);

	test('stopped, one try after fifteen minutes; well, it goes on', async () => {
		setSystemTime(new Date('2026-11-01T10:00:00Z'));
		await guarded('k1', async () => no(401, 'User not found'));
		setSystemTime(new Date('2026-11-01T10:14:00Z'));
		await expect(guarded('k1', async () => ok())).rejects.toBeInstanceOf(AiBlocked);
		setSystemTime(new Date('2026-11-01T10:15:00Z'));
		// The try says no: stopped another fifteen minutes.
		expect((await guarded('k1', async () => no(402, NO_MONEY))).status).toBe(402);
		await expect(guarded('k1', async () => ok())).rejects.toBeInstanceOf(AiBlocked);
		setSystemTime(new Date('2026-11-01T10:30:00Z'));
		expect((await guarded('k1', async () => ok())).ok).toBe(true);
		expect(blockOf('k1')).toBeNull();
	});

	test('«Ya he recargado» sets it going', async () => {
		await guarded('k1', async () => no(401, 'User not found'));
		unblock('k1');
		expect((await guarded('k1', async () => ok())).ok).toBe(true);
	});

	test('kept from before a restart: stopped, without telling again', async () => {
		const told: (Block | null)[] = [];
		const stop = watchBlocks((_, block) => told.push(block));
		rememberBlock('k1', { at: new Date(), why: SHORT_CREDIT });
		await expect(guarded('k1', async () => ok())).rejects.toThrow(SHORT_CREDIT);
		// Read again later (each request reads the key): this module's from then on.
		unblock('k1');
		rememberBlock('k1', { at: new Date(), why: SHORT_CREDIT });
		expect(blockOf('k1')).toBeNull();
		expect(told).toEqual([null]);
		stop();
	});
});

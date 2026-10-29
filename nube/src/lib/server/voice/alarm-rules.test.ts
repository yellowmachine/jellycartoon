import { expect, test } from 'bun:test';
import { FAILING_EVERY_MS, FALLBACK_EVERY_MS, voiceAlarm } from './alarm-rules.ts';

const clock = () => {
	let t = 0;
	return { now: () => t, pass: (ms: number) => (t += ms) };
};

test('one failure is a hiccup; the second in a row is told', () => {
	const alarm = voiceAlarm(clock().now);
	expect(alarm.failed('A', 'x')).toBeNull();
	expect(alarm.failed('A', 'y')).toEqual({ kind: 'failing', detail: 'y' });
});

test('an answer in between starts again', () => {
	const alarm = voiceAlarm(clock().now);
	alarm.failed('A', 'x');
	alarm.ok('A');
	expect(alarm.failed('A', 'x')).toBeNull();
});

test('told once in its while, and again after it', () => {
	const c = clock();
	const alarm = voiceAlarm(c.now);
	alarm.failed('A', 'x');
	expect(alarm.failed('A', 'x')).not.toBeNull();
	expect(alarm.failed('A', 'x')).toBeNull();
	c.pass(FAILING_EVERY_MS);
	expect(alarm.failed('A', 'x')).not.toBeNull();
});

test('each family its own', () => {
	const alarm = voiceAlarm(clock().now);
	alarm.failed('A', 'x');
	expect(alarm.failed('B', 'x')).toBeNull();
});

test('the fallback answering, once a day', () => {
	const c = clock();
	const alarm = voiceAlarm(c.now);
	expect(alarm.fellBack('A', 'why')).toEqual({ kind: 'fallback', detail: 'why' });
	expect(alarm.fellBack('A', 'why')).toBeNull();
	c.pass(FALLBACK_EVERY_MS);
	expect(alarm.fellBack('A', 'why')).not.toBeNull();
});

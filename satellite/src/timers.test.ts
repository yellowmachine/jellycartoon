import { describe, expect, test } from 'bun:test';
import { Timers } from './timers.ts';

function timers() {
	let now = 1_000_000;
	const saved: unknown[] = [];
	const t = new Timers(
		(s) => saved.push(structuredClone(s)),
		() => now
	);
	return { t, saved, pass: (ms: number) => (now += ms) };
}

describe('Timers', () => {
	test('one rings once at its end, and is told to the AI', () => {
		const { t, pass } = timers();
		t.start('la pasta', 60);
		expect(t.describe()).toEqual(['la pasta, quedan 1 min']);
		pass(30_000);
		expect(t.due()).toEqual([]);
		pass(30_000);
		expect(t.due().map((x) => x.label)).toEqual(['la pasta']);
		expect(t.due()).toEqual([]);
		expect(t.describe()).toEqual(['la pasta, ya ha terminado y está sonando']);
		t.silence();
		expect(t.describe()[0]).toStartWith('la pasta, ya sonó y se paró');
	});

	test('without a name, its time; two of them, two timers', () => {
		const { t } = timers();
		expect(t.start('temporizador', 300)).toBe('5 minutos');
		expect(t.start('', 300)).toBe('5 minutos (2)');
		expect(t.running).toHaveLength(2);
	});

	test('the same name starts over, and a prepared one starts', () => {
		const { t } = timers();
		t.prepare('el arroz', 1800, 'esté el sofrito');
		expect(t.describe()).toEqual(['el arroz, 30 min, preparado: arranca cuando esté el sofrito']);
		t.start('El arroz', 1800);
		expect(t.prepared).toEqual([]);
		t.start('el arroz', 600);
		expect(t.running).toHaveLength(1);
	});

	test('taken away, by name or all', () => {
		const { t } = timers();
		t.start('la pasta', 60);
		t.start('el horno', 60);
		expect(t.cancel('LA PASTA')).toBe(1);
		expect(t.describe()[0]).toStartWith('la pasta, ya se quitó');
		expect(t.cancel(null)).toBe(1);
		expect(t.running).toEqual([]);
	});

	test('saved, and loaded back as they were', () => {
		const { t, saved } = timers();
		t.start('la pasta', 60);
		t.prepare('el arroz', 1800, 'hierva');
		const again = new Timers(() => {});
		again.load(saved.at(-1));
		expect(again.running).toEqual(t.running);
		expect(again.prepared).toEqual(t.prepared);
		again.load({ running: [{ label: 3 }], prepared: 'no' });
		expect(again.running).toEqual([]);
	});
});

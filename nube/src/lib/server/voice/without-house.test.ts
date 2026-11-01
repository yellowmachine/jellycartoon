import { expect, test } from 'bun:test';
import { orderWithoutHouse } from './without-house.ts';
import { audioFormat } from '../openrouter.ts';

const request = {
	text: '¿qué tiempo hace en Toledo?',
	here: null,
	video: null,
	history: [],
	timers: [],
	recipe: null,
	film: null,
	car: false,
	position: null,
	navigation: null,
	trip: null,
	ahead: null
};

test('an order without the house: an adult, and nothing of a house', () => {
	const order = orderWithoutHouse(request, 'Lucía');
	expect(order.who).toEqual({ name: 'Lucía', kid: false });
	expect(order.satellite).toBeNull();
	expect(order.house).toMatchObject({ speakers: false, salon: false, rooms: [], tools: [] });
	expect(order.house.sounding).toBe('[Ahora suena. Aquí: nada.]');
	expect(order.house.today).toStartWith('Hoy es ');
	expect(orderWithoutHouse(request, 'Lucía').order).not.toBe(order.order);
});

test("a recording's format, as OpenRouter names it", () => {
	expect(audioFormat('audio/webm;codecs=opus')).toBe('webm');
	expect(audioFormat('audio/mp4')).toBe('m4a');
	expect(audioFormat('audio/wav')).toBe('wav');
	expect(audioFormat('video/webm')).toBeNull();
});

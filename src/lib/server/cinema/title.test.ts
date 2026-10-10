import { describe, expect, test } from 'bun:test';
import { parseMovieName } from './title.ts';

describe('parseMovieName', () => {
	// Real names from the films folder.
	const cases: [string, string, number | null][] = [
		['Casablanca.mkv', 'Casablanca', null],
		['A Fistful of Dollars (1964).mkv', 'A Fistful of Dollars', 1964],
		['El señor de los anillos (1978).mkv', 'El señor de los anillos', 1978],
		['Psycho_t02.mkv', 'Psycho', null],
		['El_Tercer_Hombre_t01.mkv', 'El Tercer Hombre', null],
		['Hotel Transylvania 2 T01.mkv', 'Hotel Transylvania 2', null],
		['Hotel Transylvania 3-Fpl Mainfeature T15.mkv', 'Hotel Transylvania 3', null],
		['Wall•e Disc 1 T02.mkv', 'Wall•e', null],
		['Sleeping Beauty Disc 1_t01.mkv', 'Sleeping Beauty', null],
		['Pinocchio Disc 1.mkv', 'Pinocchio', null],
		['la_niebla.mkv', 'La niebla', null],
		['laura.mkv', 'Laura', null],
		['Monstruos, S.A..mkv', 'Monstruos, S.A.', null],
		['JUAN PABLO II.1.mkv', 'JUAN PABLO II.1', null],
		['2012.mkv', '2012', null],
		['2001 - Una odisea del espacio.mkv', '2001 - Una odisea del espacio', null],
		[
			'Who Framed Roger Rabbit 25th Anniversary Edition T00.mkv',
			'Who Framed Roger Rabbit 25th Anniversary Edition',
			null
		],
		['¡cómo Está El Servicio! (1968).mkv', '¡cómo Está El Servicio!', 1968],
		['Terminator 2 - El juicio final.mkv', 'Terminator 2 - El juicio final', null],
		[
			'El Señor de los Anillos - Las Dos Torres (Ext) Parte 1.mkv',
			'El Señor de los Anillos - Las Dos Torres (Ext) Parte 1',
			null
		],
		[
			"Mickey's Christmas Carol 30th Anniversary Special Edition",
			"Mickey's Christmas Carol 30th Anniversary Special Edition",
			null
		]
	];
	for (const [name, title, year] of cases) {
		test(name, () => expect(parseMovieName(name.replace(/\.mkv$/, ''))).toEqual({ title, year }));
	}
});

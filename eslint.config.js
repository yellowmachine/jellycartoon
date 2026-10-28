import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignore = (dir) => path.resolve(import.meta.dirname, dir, '.gitignore');

/** The whole repository (#253): the house's app, the cloud's (nube/) and what they share (packages/). */
export default defineConfig(
	includeIgnoreFile(gitignore('.')),
	// The cloud's own, from its folder: its build and SvelteKit's generated files.
	{ ignores: ['nube/.svelte-kit/', 'nube/build/'] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		rules: {
			// The apps live at their domain's root (no `paths.base`): a plain href is already right.
			'svelte/no-navigation-without-resolve': 'off',
			// It flags maps and sets made and used inside a function or a $derived, which need no
			// reactivity; where they do, the code uses SvelteMap and SvelteSet.
			'svelte/prefer-svelte-reactivity': 'off',
			// `{' '}`: a space Svelte would otherwise trim at the edge of a block («A, B, C»).
			'svelte/no-useless-mustaches': 'off',
			// `_`, or a name starting with it: left out on purpose (`const { id: _, ...rest } = x`).
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
					destructuredArrayIgnorePattern: '^_',
					ignoreRestSiblings: true
				}
			]
		}
	}
);

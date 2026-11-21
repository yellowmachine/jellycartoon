// «Código» → Componentes: the .d.ts of packages/comun's Svelte components, written by svelte2tsx's
// emitDts (the same as @sveltejs/package), for TypeDoc, which does not read .svelte. Each
// component's `<!-- @component -->` and its exported `XxxProps` interface reach them. Run by
// `bun run codigo` before Astro; the output (.componentes/) is not in git.
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { emitDts } from 'svelte2tsx';

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const out = fileURLToPath(new URL('../.componentes/comun', import.meta.url));

rmSync(out, { recursive: true, force: true });
// emitDts looks for the tsconfig from the working directory: the house's, which includes comun.
process.chdir(repo);
await emitDts({
	declarationDir: out,
	svelteShimsPath: require.resolve('svelte2tsx/svelte-shims-v4.d.ts'),
	libRoot: `${repo}packages/comun/src`
});

import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  minify: !watch,
  sourcemap: true,
  format: 'esm',
  target: ['es2020', 'safari14'],
  outfile: 'public/app.js',
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}

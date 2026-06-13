import * as esbuild from 'esbuild'

const shared = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  external: ['pdfjs-dist', 'jszip'],
}

const watch = process.argv.includes('--watch')

// ESM build — core + web component
const ctx1 = await esbuild.context({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
})

// IIFE build — auto-registers <mineru-layout-viewer>, all deps bundled
const ctx2 = await esbuild.context({
  entryPoints: ['src/mineru-viewer.ts'],
  outfile: 'dist/mineru-layout-viewer.iife.js',
  bundle: true,
  format: 'iife',
  target: 'es2022',
  globalName: 'MineruViewer',
  sourcemap: true,
  // Bundle pdfjs-dist and jszip into IIFE so <script> tag works standalone
  external: [],
})

if (watch) {
  await Promise.all([ctx1.watch(), ctx2.watch()])
  console.log('👀 watching...')
} else {
  await Promise.all([ctx1.rebuild(), ctx2.rebuild()])
  console.log('✅ built dist/index.mjs + dist/mineru-layout-viewer.iife.js')
  await ctx1.dispose()
  await ctx2.dispose()
}

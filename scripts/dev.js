// @ts-check

// Using esbuild for faster dev builds.
// We are still using Rollup for production builds because it generates
// smaller files and provides better tree-shaking.

// esbuild 
import esbuild from 'esbuild'
import fs from 'node:fs'
/**
 * dirname(path): 返回给定路径的目录名。例如，dirname('/home/user/file.txt') 将返回 /home/user。
 * relative(from, to): 返回从 from 到 to 的相对路径。例如，relative('/data/orandea/test/aaa', '/data/orandea/impl/bbb') 将返回 '../../impl/bbb'。
 * resolve(...paths): 将多个路径段组合成一个绝对路径。例如，resolve('/foo', './bar', 'baz') 将返回 '/foo/bar/baz'。
 */
import { dirname, relative, resolve } from 'node:path'
/**
 * fileURLToPath(url): 将文件 URL 转换为文件路径。
 * 具体来说，它解决了 Node.js 模块中使用 __filename 或 __dirname  获取文件路径时，在 ES 模块中遇到的一些问题。
 * ES 模块中的 __filename 和 __dirname  :
 *   在传统的 CommonJS 模块中，__filename 和 __dirname 分别代表当前模块文件的绝对路径和当前模块所在的目录路径。
 *   但是，在 ES 模块中，__filename 和 __dirname 不再被自动定义。
 * fileURLToPath 的作用:
 *   fileURLToPath 函数可以将一个 URL 对象转换为一个文件系统的绝对路径。
 *   在 ES 模块中，可以通过 import.meta.url 获取当前模块的 URL。
 *   然后，使用 fileURLToPath(import.meta.url) 即可将 URL 转换为文件系统的绝对路径。
 * fileURLToPath  是用来解决 ES 模块中获取文件路径问题的一个重要工具。它将 URL 对象转换为文件系统路径，
 *   方便您在 ES 模块中使用 __filename 和 __dirname  等变量。
 */
import { fileURLToPath } from 'node:url'
/**
 * createRequire(filename): 创建一个 require 函数，该函数可以加载指定路径的模块。
 * 具体来说，createRequire 函数可以创建一个 require 函数，该函数可以加载指定路径的模块。
 * 这个函数的作用是用来解决 Node.js 模块中使用 require 时，在 ES 模块中遇到的一些问题。
 * 在传统的 CommonJS 模块中，require 函数可以加载模块文件，并返回模块的 exports 对象。
 * 但是，在 ES 模块中，require 函数不能被直接使用。
 * createRequire 函数的作用是创建一个可以加载指定路径的模块的 require 函数。
 * 这样，在 ES 模块中就可以使用 require 函数来加载模块文件了。
 */
import { createRequire } from 'node:module'
/**
 * parseArgs(args): 解析命令行参数。
 * 具体来说，parseArgs 函数可以解析命令行参数，并返回一个包含选项和位置参数的对象。
 * 这个函数的作用是用来解析命令行参数，并将其转换为对象。
 * 这样，我们就可以在 Node.js 脚本中使用 parseArgs 函数来解析命令行参数。
 */
import { parseArgs } from 'node:util'
/**
 * polyfillNode(): 为 esbuild 添加 polyfill-node 插件。
 */
import { polyfillNode } from 'esbuild-plugin-polyfill-node'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const {
  values: { format: rawFormat, prod, inline: inlineDeps },
  positionals,
} = parseArgs({
  allowPositionals: true,
  options: {
    // 设置打包格式 --format xxx || -f xxx
    format: {
      type: 'string',
      short: 'f',
      default: 'global',
    },
    // 设置是否为生产环境 --prod || -p
    prod: {
      type: 'boolean',
      short: 'p',
      default: false,
    },
    // 设置是否内联依赖 --inline || -i
    inline: {
      type: 'boolean',
      short: 'i',
      default: false,
    },
  },
})

const format = rawFormat || 'global'
// 设置打包目标，不传默认打包vue
const targets = positionals.length ? positionals : ['vue']

// resolve output
// 设置打包格式
const outputFormat = format.startsWith('global')
  ? 'iife'
  : format === 'cjs'
    ? 'cjs'
    : 'esm'

const postfix = format.endsWith('-runtime')
  ? `runtime.${format.replace(/-runtime$/, '')}`
  : format

const privatePackages = fs.readdirSync('packages-private')

for (const target of targets) {
  const pkgBase = privatePackages.includes(target)
    ? `packages-private`
    : `packages`
  const pkgBasePath = `../${pkgBase}/${target}`
  const pkg = require(`${pkgBasePath}/package.json`)
  const outfile = resolve(
    __dirname,
    `${pkgBasePath}/dist/${
      target === 'vue-compat' ? `vue` : target
    }.${postfix}.${prod ? `prod.` : ``}js`,
  )
  const relativeOutfile = relative(process.cwd(), outfile)

  // resolve externals
  // TODO this logic is largely duplicated from rollup.config.js
  /** @type {string[]} */
  let external = []
  if (!inlineDeps) {
    // cjs & esm-bundler: external all deps
    if (format === 'cjs' || format.includes('esm-bundler')) {
      external = [
        ...external,
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.peerDependencies || {}),
        // for @vue/compiler-sfc / server-renderer
        'path',
        'url',
        'stream',
      ]
    }

    if (target === 'compiler-sfc') {
      const consolidatePkgPath = require.resolve(
        '@vue/consolidate/package.json',
        {
          paths: [resolve(__dirname, `../packages/${target}/`)],
        },
      )
      const consolidateDeps = Object.keys(
        require(consolidatePkgPath).devDependencies,
      )
      external = [
        ...external,
        ...consolidateDeps,
        'fs',
        'vm',
        'crypto',
        'react-dom/server',
        'teacup/lib/express',
        'arc-templates/dist/es5',
        'then-pug',
        'then-jade',
      ]
    }
  }
  /** @type {Array<import('esbuild').Plugin>} */
  const plugins = [
    {
      name: 'log-rebuild',
      setup(build) {
        build.onEnd(() => {
          console.log(`built: ${relativeOutfile}`)
        })
      },
    },
  ]

  if (format !== 'cjs' && pkg.buildOptions?.enableNonBrowserBranches) {
    plugins.push(polyfillNode())
  }

  esbuild
    .context({
      entryPoints: [resolve(__dirname, `${pkgBasePath}/src/index.ts`)],
      outfile,
      bundle: true,
      external,
      sourcemap: true,
      format: outputFormat,
      globalName: pkg.buildOptions?.name,
      platform: format === 'cjs' ? 'node' : 'browser',
      plugins,
      define: {
        __COMMIT__: `"dev"`,
        __VERSION__: `"${pkg.version}"`,
        __DEV__: prod ? `false` : `true`,
        __TEST__: `false`,
        __BROWSER__: String(
          format !== 'cjs' && !pkg.buildOptions?.enableNonBrowserBranches,
        ),
        __GLOBAL__: String(format === 'global'),
        __ESM_BUNDLER__: String(format.includes('esm-bundler')),
        __ESM_BROWSER__: String(format.includes('esm-browser')),
        __CJS__: String(format === 'cjs'),
        __SSR__: String(format !== 'global'),
        __COMPAT__: String(target === 'vue-compat'),
        __FEATURE_SUSPENSE__: `true`,
        __FEATURE_OPTIONS_API__: `true`,
        __FEATURE_PROD_DEVTOOLS__: `false`,
        __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__: `true`,
      },
    })
    .then(ctx => ctx.watch())
}

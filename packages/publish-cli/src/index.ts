#!/usr/bin/env node
import { Command } from 'commander'
import { loadConfig } from './config'
import { gc, newsPush, patch, publishLauncher, release, rollback, verify, type Ctx } from './commands'
import { DryRunStore, LocalDirStore, R2Store, type PublishStore } from './store'

const program = new Command()

program
  .name('yufa-publish')
  .description('Publishes game builds, patches, news and launcher builds for Yufa ToS Classic')
  .option('--config <path>', 'path to publish.config.json (default: search upward from cwd)')
  .option('--local-out <dir>', 'write to a local directory instead of R2')
  .option('--dry-run', 'log what would be written without writing')

function buildCtx(): Ctx {
  const opts = program.opts<{ config?: string; localOut?: string; dryRun?: boolean }>()
  const cfg = loadConfig(opts.config)
  let store: PublishStore = opts.localOut ? new LocalDirStore(opts.localOut) : new R2Store(cfg)
  if (opts.dryRun) store = new DryRunStore(store)
  console.log(`target: ${store.describe()}`)
  return { cfg, store }
}

program
  .command('release')
  .description('publish a complete Build from a local game folder')
  .requiredOption('--dir <folder>', 'the game folder (contains data\\, patch\\, release\\)')
  .option('--label <text>', 'human label for the Build (e.g. "1.0")')
  .option('--min-launcher <version>', 'minimum launcher version allowed to install this Build')
  .action(async (o: { dir: string; label?: string; minLauncher?: string }) => {
    await release(buildCtx(), { dir: o.dir, label: o.label, minLauncher: o.minLauncher })
  })

program
  .command('patch')
  .description('publish a Build = current Build + patch ipf(s): <revision>_001001.ipf above the current revision')
  .argument('<files...>')
  .action(async (files: string[]) => {
    await patch(buildCtx(), { files })
  })

program
  .command('rollback')
  .description('make a stored Build current again')
  .argument('<build>')
  .action(async (build: string) => {
    await rollback(buildCtx(), Number.parseInt(build, 10))
  })

const news = program.command('news').description('manage the launcher news feed')
news
  .command('push')
  .description('validate and publish news.json')
  .option('--file <path>', 'news feed file', 'news/news.json')
  .action(async (o: { file: string }) => {
    await newsPush(buildCtx(), o.file)
  })

program
  .command('verify')
  .description('check that every Blob the Current Manifest references is stored with the right size')
  .option('--mirror <dir>', 'also compare the Current Manifest against this local game folder, hash by hash')
  .action(async (o: { mirror?: string }) => {
    const result = await verify(buildCtx(), { mirror: o.mirror })
    if (!result.ok) process.exitCode = 1
  })

program
  .command('gc')
  .description('delete Blobs that none of the N newest stored Builds (nor the current one) reference')
  .requiredOption('--keep <n>', 'how many of the newest Builds keep their Blobs')
  .action(async (o: { keep: string }) => {
    await gc(buildCtx(), { keep: Number.parseInt(o.keep, 10) })
  })

program
  .command('launcher')
  .description('publish an electron-builder output dir as the self-update feed')
  .argument('<distDir>')
  .option('--min-launcher <version>', 'also publish a new Build requiring this launcher version')
  .action(async (distDir: string, o: { minLauncher?: string }) => {
    await publishLauncher(buildCtx(), distDir, o.minLauncher)
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})

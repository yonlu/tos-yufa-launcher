#!/usr/bin/env node
import { Command } from 'commander'
import { loadConfig } from './config'
import { newsPush, patch, publishLauncher, rollback, seed, verify, type Ctx } from './commands'
import { DryRunStore, LocalDirStore, R2Store, type PatchStore } from './store'

const program = new Command()

program
  .name('yufa-publish')
  .description('Publishes patches, news and launcher builds for Yufa ToS Classic')
  .option('--config <path>', 'path to publish.config.json (default: search upward from cwd)')
  .option('--local-out <dir>', 'write to a local directory instead of R2')
  .option('--dry-run', 'log what would be written without writing')

function buildCtx(): Ctx {
  const opts = program.opts<{ config?: string; localOut?: string; dryRun?: boolean }>()
  const cfg = loadConfig(opts.config)
  let store: PatchStore = opts.localOut ? new LocalDirStore(opts.localOut) : new R2Store(cfg)
  if (opts.dryRun) store = new DryRunStore(store)
  console.log(`target: ${store.describe()}`)
  return { cfg, store }
}

program
  .command('seed')
  .description('build the initial manifest from an existing game patch folder')
  .requiredOption('--patch-dir <dir>', 'the game\'s patch\\ folder')
  .option('--include <names...>', 'candidate files to include in the manifest', [])
  .option('--exclude <names...>', 'candidate files to leave out', [])
  .action(async (o: { patchDir: string; include: string[]; exclude: string[] }) => {
    await seed(buildCtx(), { patchDir: o.patchDir, include: o.include, exclude: o.exclude })
  })

program
  .command('patch')
  .description('publish new patch ipf(s): <revision>_001001.ipf, revision above the current one')
  .argument('<files...>')
  .action(async (files: string[]) => {
    await patch(buildCtx(), { files })
  })

program
  .command('rollback')
  .description('drop every manifest entry above the given revision')
  .argument('<revision>')
  .action(async (revision: string) => {
    await rollback(buildCtx(), Number.parseInt(revision, 10))
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
  .description('check that the store matches the manifest')
  .option('--mirror <dir>', 'also re-hash files from a local mirror directory')
  .action(async (o: { mirror?: string }) => {
    const result = await verify(buildCtx(), { mirror: o.mirror })
    if (!result.ok) process.exitCode = 1
  })

program
  .command('launcher')
  .description('publish an electron-builder output dir as the self-update feed')
  .argument('<distDir>')
  .option('--min-launcher <version>', 'also set manifest.minLauncherVersion (forces old launchers to update)')
  .action(async (distDir: string, o: { minLauncher?: string }) => {
    await publishLauncher(buildCtx(), distDir, o.minLauncher)
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})

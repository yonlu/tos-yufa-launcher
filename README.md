# Yufa ToS Classic — Launcher

Launcher + sistema de publicação de patches para o servidor Yufa | ToS - Classic.

## Pacotes

- `packages/shared` — schemas do manifest (zod), `computePlan()` (núcleo puro do patcher), tipos de IPC.
- `packages/launcher` — app Electron (electron-vite + React). UI do jogador: verificar → baixar → jogar.
- `packages/publish-cli` — CLI do admin (`npm run yufa-publish`): release / patch / rollback / news / verify / launcher.
- `tools/dev-server.ts` — servidor estático local com suporte a HTTP Range para testes E2E.

## Comandos

```
npm install                 # instala tudo (workspaces)
npm test                    # unit + integration tests (vitest)
npm run dev                 # launcher em modo dev
npm run dist                # build NSIS (electron-builder)
npm run yufa-publish -- …   # CLI de publicação
npm run dev-server          # servidor de patches local
```

## Contrato de patch (cliente ToS)

O cliente carrega **todos** os `patch\*.ipf` (glob `../patch/*.ipf`); revisões maiores sobrescrevem menores e o `data\`. `release\release.revision.txt` guarda a revisão mais alta aplicada. O launcher só gerencia arquivos `^\d+_001001\.ipf$` com revisão > 234929 (linha de corte da instalação base).

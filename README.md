# Yufa ToS Classic — Launcher

Launcher + sistema de publicação de patches para o servidor Yufa | ToS - Classic.

## Pacotes

- `packages/shared` — schemas do manifest e do Install Record (zod), `computePlan()` (núcleo puro do patcher: manifest + Install Record + scan local → baixar / semear / apagar), tipos de IPC.
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

O cliente carrega **todos** os `patch\*.ipf` (glob `../patch/*.ipf`); revisões maiores sobrescrevem menores e o `data\`. `release\release.revision.txt` guarda a revisão mais alta aplicada; o launcher avança esse arquivo conforme cada patch archive termina e o iguala à revisão do manifest ao final (0 quando o Build não tem patch archives).

## Pasta do jogo (lado do jogador)

Sem jogo instalado, o launcher abre o painel de instalação: pasta sugerida `C:\Hyped Games\ToS Classic` (unidade do sistema), Procurar, espaço livre × necessário (Build + margem de 200 MB). Instalar só habilita quando a pasta é um caminho absoluto fora de Program Files e Windows, o ancestral existente mais próximo aceita escrita e a unidade tem espaço; uma pasta com Install Record incompleto ou `release\Yuka.exe` vira "Continuar instalação". `YUFA_GAME_DIR` apontando para uma pasta vazia mostra esse painel (smoke de screenshot).

O manifest lista cada Managed File do Build; o launcher instala tudo a partir de uma pasta vazia e guarda o que instalou em `.yufa-install.json` (Install Record: build, `completed`, path/size/mtime/sha256 por arquivo, Seed-once já semeados). Só apaga caminhos presentes nesse registro. Uma pasta "válida" tem Install Record ou `release\Yuka.exe`; sem os dois, o estado é `not-installed`. Instalação interrompida retoma no próximo `check`: arquivos concluídos não são baixados de novo, `.part` continuam via Range.

Confiança no `check`: um Managed File registrado é aceito quando size e mtime batem com o registro e o hash do registro bate com o manifest; arquivos de até 16 MB são re-hasheados em todo `check` mesmo assim; maiores só no Repair, que re-hasheia todos e baixa os corrompidos (fase `hashing` no progresso). Seed-once já semeado nunca mais é baixado, verificado ou apagado. Jogo offline só é oferecido com Install Record `completed`.

# Yufa ToS Classic — Launcher

Launcher + sistema de publicação de patches para o servidor Yufa | ToS - Classic.

## Pacotes

- `packages/shared` — schemas do manifest e do Install Record (zod), `computePlan()` (núcleo puro do patcher: manifest + Install Record + scan local → baixar / semear / apagar), tipos de IPC.
- `packages/launcher` — app Electron (electron-vite + React). UI do jogador: verificar → baixar → jogar.
- `packages/publish-cli` — CLI do admin (`npm run yufa-publish`): release / patch / rollback / news / verify (`--mirror <pasta>` compara hashes com a pasta local) / gc (`--keep N` apaga Blobs que nenhum dos N Builds mais recentes nem o atual referencia; nunca apaga Manifests) / redist push (`--dir <pasta>` sobe os instaladores de runtime e escreve `redist/index.json` por último) / launcher.
- `tools/dev-server.ts` — servidor estático local com suporte a HTTP Range para testes E2E.
- `tools/e2e-setup.ts` / `tools/e2e-smoke.ts` — sandbox E2E local: árvore de jogo falsa publicada como Build, e o ensaio automático (instalar → atualizar → rollback) com o launcher empacotado. Ver [Sandbox E2E local](#sandbox-e2e-local).

## Comandos

```
npm install                 # instala tudo (workspaces)
npm test                    # unit + integration tests (vitest)
npm run typecheck           # tsc em shared, publish-cli, launcher e tools
npm run dev                 # launcher em modo dev
npm run dist                # build NSIS (electron-builder) → packages/launcher/release-builds
npm run yufa-publish -- …   # CLI de publicação
npm run dev-server          # servidor de patches local
npm run e2e-setup -- …      # monta/publica o sandbox E2E (--bump publica o Build seguinte)
npm run e2e                 # ensaio completo com o launcher empacotado (precisa de npm run dist)
npm run mock                # launcher em dev contra o sandbox, download lento, Jogar abre o cliente real
```

## Sandbox E2E local

Tudo que o operador faria contra o R2 dá para ensaiar contra uma pasta local servida pelo `dev-server`.

```
npm run e2e-setup -- --base ./e2e-sandbox        # Build 1: árvore falsa → release → ./e2e-sandbox/store
npm run dev-server -- --root ./e2e-sandbox/store --port 8787
```

O sandbox contém:

- `tree/` — a pasta de jogo falsa de onde os Builds saem (o Mirror, no vocabulário do `CONTEXT.md`): `data\`, `patch\` (2 archives de 3 MB por padrão; `--count`, `--size`), `release\` com `Yuka.exe` de mentira, `a.dll`, `uilayout.xml` (Seed-once) **e** o lixo que o hard guard descarta (`user.xml`, `release.revision.txt`, `screenshot\`, `log_Client\`) mais `release\patch\` (excluído pela config). Confira no `store/manifest.json` que nada disso foi publicado.
- `store/` — o layout exato do bucket (`manifest.json`, `manifests/`, `objects/`, `news/`).
- `game/` — pasta **vazia** para o launcher instalar.
- `publish.config.json` — a config do CLI apontando para o dev-server, para rollback/patch/verify à mão.

Aponte o launcher (dev ou empacotado) para o sandbox com variáveis de ambiente:

| Variável | Efeito |
| --- | --- |
| `YUFA_MANIFEST_URL` | `http://127.0.0.1:8787/manifest.json`; news e `redist/index.json` derivam dela |
| `YUFA_GAME_DIR` | a pasta do jogo (vazia → painel de instalação) |
| `YUFA_USERDATA` | settings e logs isolados por execução |
| `YUFA_AUTO=update` / `play` | instala/atualiza sozinho; `play` também clica Jogar |
| `YUFA_LAUNCH_EXE` | executável que Jogar abre (cliente real fora do sandbox) |
| `YUFA_SCREENSHOT` (+ `_DELAY` ms) | captura a janela nesse caminho e sai — o smoke de screenshot |
| `YUFA_REDIST_INDEX_URL`, `YUFA_LAUNCHER_FEED_URL` | índices alternativos de runtimes e de self-update |

Ciclo completo à mão:

```
npm run e2e-setup -- --base ./e2e-sandbox --bump          # Build 2: muda release\a.dll e adiciona 1 patch archive
npm run yufa-publish -- --config e2e-sandbox/publish.config.json --local-out e2e-sandbox/store rollback 1
npm run yufa-publish -- --config e2e-sandbox/publish.config.json --local-out e2e-sandbox/store verify --mirror e2e-sandbox/tree
```

Ou tudo de uma vez, com o launcher empacotado, cada etapa fotografada em `e2e-sandbox/shots/` e conferida pelo Install Record e pelos hashes na pasta do jogo:

```
npm run dist
npm run e2e        # painel de instalação → instala Build 1 → atualiza para Build 2 → rollback 1
```

## Launcher (instalação e self-update)

Produto **Yufa Launcher**, publicado por **Hyped Games**: instalador NSIS one-click por usuário, sem UAC, em `C:\Hyped Games\Yufa Launcher` (unidade do sistema; `packages/launcher/build/installer.nsh`), atalho no menu Iniciar em `Hyped Games`. O `appId` (`br.com.yufa.launcher`) e o feed `launcher/latest.yml` não mudaram: um launcher já instalado continua se atualizando **na pasta onde está** — o instalador só escolhe a pasta nova quando não encontra instalação anterior no registro. Mover uma instalação antiga é desinstalar e instalar de novo (uma vez).

## Contrato de patch (cliente ToS)

O cliente carrega **todos** os `patch\*.ipf` (glob `../patch/*.ipf`); revisões maiores sobrescrevem menores e o `data\`. `release\release.revision.txt` guarda a revisão mais alta aplicada; o launcher avança esse arquivo conforme cada patch archive termina e o iguala à revisão do manifest ao final (0 quando o Build não tem patch archives).

## Pasta do jogo (lado do jogador)

Sem jogo instalado, o launcher abre o painel de instalação: pasta sugerida `C:\Hyped Games\ToS Classic` (unidade do sistema), Procurar, espaço livre × necessário (Build + margem de 200 MB). Instalar só habilita quando a pasta é um caminho absoluto fora de Program Files e Windows, o ancestral existente mais próximo aceita escrita e a unidade tem espaço; uma pasta com Install Record incompleto ou `release\Yuka.exe` vira "Continuar instalação". `YUFA_GAME_DIR` apontando para uma pasta vazia mostra esse painel (smoke de screenshot).

O manifest lista cada Managed File do Build; o launcher instala tudo a partir de uma pasta vazia e guarda o que instalou em `.yufa-install.json` (Install Record: build, `completed`, path/size/mtime/sha256 por arquivo, Seed-once já semeados). Só apaga caminhos presentes nesse registro. Uma pasta "válida" tem Install Record ou `release\Yuka.exe`; sem os dois, o estado é `not-installed`. Instalação interrompida retoma no próximo `check`: arquivos concluídos não são baixados de novo, `.part` continuam via Range.

Confiança no `check`: um Managed File registrado é aceito quando size e mtime batem com o registro e o hash do registro bate com o manifest; arquivos de até 16 MB são re-hasheados em todo `check` mesmo assim; maiores só no Repair, que re-hasheia todos e baixa os corrompidos (fase `hashing` no progresso). Seed-once já semeado nunca mais é baixado, verificado ou apagado. Jogo offline só é oferecido com Install Record `completed`.

## Runtimes do Windows (Redistributables)

O cliente é 32-bit e precisa do VC++ 2015+ x86 e do DirectX de junho de 2010 (`vcruntime140.dll` e `d3dx9_43.dll` em `SysWOW64`). Quando uma instalação termina (a primeira vez que o Install Record fica `completed`, mesmo retomada), o launcher sonda os dois e, se faltar algum, baixa só os instaladores necessários de `redist/` para uma pasta temporária (verificados por tamanho e sha256 contra `redist/index.json`, pelo mesmo motor de download), avisa que vem um único aviso de administrador e roda tudo em silêncio numa só invocação elevada do PowerShell (`vc_redist.x86.exe /install /quiet /norestart`; `DXSETUP.exe /silent`). Estado `installing-runtimes` no meio; o resultado vai em `redist` no evento `ready`. Falha ou UAC recusado (`elevation-declined`) vira um aviso na UI que **não bloqueia o Jogar**. Atualizações comuns nunca sondam; "Verificar runtimes do Windows" nas Configurações repete o fluxo a qualquer hora. `YUFA_REDIST_INDEX_URL` sobrescreve o índice em testes locais.

`redist push --dir <pasta>` publica o conjunto enxuto (as subpastas são obrigatórias, nomes dos arquivos sem distinção de maiúsculas):

```
<pasta>\vcredist\vc_redist.x86.exe            # Visual C++ 2015-2022 Redistributable (x86)
<pasta>\directx\DXSETUP.exe                   # DirectX End-User Runtimes (June 2010), só o que o d3dx9_43 precisa:
<pasta>\directx\DSETUP.dll
<pasta>\directx\dsetup32.dll
<pasta>\directx\dxupdate.cab
<pasta>\directx\Jun2010_d3dx9_43_x86.cab      # qualquer *d3dx9_43_x86.cab serve; outros cabs extras são enviados também
```

Os arquivos são enviados por caminho (não por hash) com `no-cache`, e o `index.json` por último — um launcher nunca lê um índice cujos arquivos ainda não subiram. Jogadores com os runtimes presentes nunca baixam nada disso.

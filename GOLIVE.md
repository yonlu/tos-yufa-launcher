# Go-live — Yufa ToS Classic Launcher

Estado atual: o pipeline **Build → Manifest → Blob** funciona localmente de ponta a ponta — `npm test` (CLI,
motor de download, patcher, sandbox), e `npm run e2e` ensaia instalar / atualizar / rollback com o launcher
**empacotado** contra o `dev-server`. O que falta é só a infraestrutura real (R2 + domínio) e dois testes de
aceitação que dependem do cliente de verdade (passo 7). Vocabulário em `CONTEXT.md`; decisões em `docs/adr/`.

## Layout do bucket

| Chave                    | Conteúdo                                          | Cache-Control (já enviado pelo CLI) |
| ------------------------ | ------------------------------------------------- | ----------------------------------- |
| `manifest.json`          | Current Manifest — o Build que os jogadores veem  | `no-cache`                          |
| `manifests/<build>.json` | um Manifest por Build, imutável (alvo de rollback) | `immutable`                         |
| `objects/<sha256>`       | Blobs — o conteúdo de cada arquivo, por hash      | `immutable`                         |
| `redist/…`, `redist/index.json` | instaladores de runtime, por caminho; índice escrito por último | `no-cache` |
| `news/news.json`         | feed de notícias                                  | `no-cache`                          |
| `launcher/*.exe`, `*.blockmap` / `launcher/latest.yml` | self-update do launcher (yml por último) | `immutable` / `no-cache` |

Ordem de publicação de um Build: Blobs → `manifests/<build>.json` → `manifest.json`. Um jogador nunca vê um
Manifest apontando para um Blob que ainda não subiu (ADR 0001). Rollback reescreve só `manifest.json`.

## Decisão — domínio

Escolha o domínio público (ex.: `patch.yufa.com.br`) e substitua `REPLACE_WITH_DOMAIN` / `REPLACE_WITH_ACCOUNT_ID` em:

- `publish.config.json` (`endpoint`, `publicBaseUrl`)
- `packages/launcher/src/main/constants.ts` (`MANIFEST_URL`, `LAUNCHER_FEED_URL`)
- `packages/launcher/electron-builder.yml` (`publish.url`)

## Passos

1. **Cloudflare R2**: crie o bucket (`yufa-patch`), um token de API (Object Read & Write) e conecte o domínio
   customizado ao bucket. Egress é gratuito; R2 responde HTTP Range (necessário para retomar downloads).
   Crie duas Cache Rules na zona: (1) **bypass** para `manifest.json`, `news/*`, `redist/*` e `launcher/latest.yml`;
   (2) **eligible for cache** para `objects/*`, `manifests/*` e `launcher/*` (menos `latest.yml`) — sem essa
   regra o Cloudflare só cacheia por extensão de arquivo, e `objects/<sha256>` não tem extensão, então todo
   download iria direto ao R2. O Edge TTL padrão respeita o `max-age=31536000, immutable` que o CLI envia.
   `scripts/r2-setup.sh` (wizard) imprime as duas expressões prontas.
   Confirme depois do primeiro release:
   `curl -r 0-1023 -sw '%{http_code}' https://patch.<dominio>/objects/<sha256 de um arquivo do manifest>` → `206`.
2. **Credenciais**: `$env:R2_ACCESS_KEY_ID` / `$env:R2_SECRET_ACCESS_KEY` (nunca no repo).
3. **Primeiro Build**, direto da pasta real do jogo (a que tem `data\`, `patch\`, `release\`):
   ```
   npm run yufa-publish -- --dry-run release --dir <pasta do jogo> --label 1.0
   npm run yufa-publish -- release --dir <pasta do jogo> --label 1.0
   npm run yufa-publish -- verify --mirror <pasta do jogo>
   ```
   O `--dry-run` lista o que subiria. O **hard guard** (não configurável) deixa de fora `release\user.xml`,
   `user_c.xml`, `hud_config.xml`, `serverlist_recent.xml`, `chat_config_*.xml`, `release.revision.txt`, `*.part`,
   `addons\` e as pastas de runtime (`screenshot`, `log_Client`, `user`, `GuildEmblem`…) — é isso que impede o
   login e as configs do operador de vazarem, mesmo publicando de uma pasta jogada. `excludes` no
   `publish.config.json` tira o resto (`release\patch\`, `_CommonRedist\` por padrão); `includes` devolve um caminho
   exato apesar dos `excludes` — hoje só `release\patch\updater.config.xml`, que o `Client_tos.exe` abre no
   `InitConfig` (lê `Config/URL[@Key="Revisions"]`) e sem o qual aborta com "Can't load config files"; nada mais
   de `release\patch\` é lido. **Durante o ensaio**, os
   `excludes` também seguram `release\Client_tos.exe`, `release\Yuka.exe` e `release\Yuka.dll` — binários ainda
   sem Themida não vão para o domínio público. Na máquina de teste, copie os três à mão depois do install
   (o patcher só apaga o que ele mesmo instalou, então sobrevivem a `check` e `rollback`). Quando os binários
   protegidos existirem: tire as três linhas dos `excludes` e rode `release` de novo — só três Blobs sobem e os
   jogadores recebem como patch normal. `seedOnce` nomeia os
   arquivos que o jogo reescreve (`uilayout.xml`, hotkeys) e o launcher só semeia uma vez.
   Todos os `patch\*.ipf` da pasta viram Managed Files, inclusive os customizados do servidor; a `revision`
   do Manifest é o maior deles (hoje 1121001) e é o que o launcher grava em `release.revision.txt`.
   **Todo patch novo precisa ser numerado acima da revisão atual** — o CLI recusa o contrário.
   A hash cache (`.yufa-hash-cache.json`, por caminho + tamanho + mtime) faz um re-release da mesma pasta
   levar segundos e subir só o que mudou.
4. **Runtimes**: extraia o `vc_redist.x86.exe` e, do DirectX End-User Runtimes (June 2010), só `DXSETUP.exe`,
   `DSETUP.dll`, `dsetup32.dll`, `dxupdate.cab` e `Jun2010_d3dx9_43_x86.cab`, nas subpastas `vcredist\` e `directx\`
   (lista no README) → `npm run yufa-publish -- redist push --dir <pasta>`. O launcher só baixa isso em máquinas
   onde falta um dos dois; sem esse push, uma instalação nova em Windows limpo termina com o aviso "runtimes não
   instalados" (o Jogar continua liberado).
5. **Notícias**: edite `news/news.json` → `npm run yufa-publish -- news push`.
6. **Launcher**: `npm run dist` → teste o `Yufa-Launcher-Setup-<versão>.exe` numa máquina limpa (instala em
   `C:\Hyped Games\Yufa Launcher`, sem UAC; o painel de instalação sugere `C:\Hyped Games\ToS Classic`) →
   `npm run yufa-publish -- launcher packages/launcher/release-builds`. Publique o instalador no site.
7. **Testes de aceitação numa instalação nova** (as duas coisas que só o cliente real responde):
   - **`user.xml`**: o hard guard não publica o do operador. Instale do zero, entre no jogo, saia e confirme que
     o cliente criou `release\user.xml` sozinho. Se ele exigir o arquivo para abrir, crie um `user.xml` limpo
     (sem login) na pasta do jogo, adicione `release/user.xml` a `seedOnce` no `publish.config.json`, tire-o do
     hard guard só se for esse arquivo limpo, e faça outro `release`.
   - **`release.revision.txt`**: o launcher grava a revisão do Manifest (o maior patch archive, hoje 1121001).
     Confirme login e carregamento de mapa com esse valor. Se o servidor validar o arquivo, é o número do
     patch archive mais alto que precisa mudar, não o launcher.

   Opcional, mas recomendado antes de anunciar: um ipf de teste com um recurso visível alterado, numerado acima
   da revisão atual → `patch <arquivo>` → launcher atualiza → recurso aparece → `rollback <build anterior>` →
   o arquivo some e o recurso volta.

## Rotina de operação

- **Patch de conteúdo**: autorar o ipf → nomear `<rev>_001001.ipf` (rev > atual) →
  `npm run yufa-publish -- patch <arquivo>`. Novo Build = Build atual + esse archive; Blob primeiro, Manifest por último.
- **Cliente rebuildado / vários arquivos**: atualize a pasta do jogo → `release --dir <pasta>` de novo. Só os
  Blobs que mudaram sobem; os jogadores baixam só o que mudou.
- **Desfazer**: `npm run yufa-publish -- rollback <build>`. Os launchers apagam o que o Build antigo não tem
  (só arquivos que eles mesmos instalaram) e restauram o que mudou.
- **Conferir**: `verify` (todo Blob referenciado existe com o tamanho certo); `verify --mirror <pasta>` também
  compara hash a hash com a pasta local.
- **Limpar**: `gc --keep 3 --dry-run` e então `gc --keep 3` apaga Blobs que nenhum dos 3 Builds mais recentes
  (nem o atual) referencia; nunca apaga Manifests nem `redist/`. **Nunca** rode `gc` com um `release`/`patch`
  em andamento: os Blobs sobem antes do Manifest que os referencia.
- **Atualizar o launcher**: bump `version` em `packages/launcher/package.json` → `npm run dist` →
  `launcher packages/launcher/release-builds` (+ `--min-launcher <ver>` para forçar a atualização antes do próximo Build).
- **Ensaio local** de qualquer coisa acima: `npm run e2e` (tudo automático) ou o fluxo manual do README.

## Decisões do ensaio (2026-09-06)

- **`user.xml`**: o cliente cria `release\user.xml` sozinho numa pasta limpa, sem `Id`. Nenhum seed necessário; o
  hard guard fica como está.
- **`UseSteamClient="NO"`** em `release\client.xml`: login e mapa funcionam sem Steam (o servidor não valida o
  encrypted app ticket). Com `YES`, o `Client_tos.exe` carrega `TosSteamClient.dll` → `steam_api.dll` (Valve, genuíno)
  e sai se a Steam não estiver aberta. Com `NO`, `TosSteamClient.dll`, `steam_api.dll`, `steamclient.dll`,
  `sdkencryptedappticket.dll` e `steam_appid.txt` viram peso morto (~10 MB) e estão nos `excludes` — o cliente só
  os alcança por `LoadLibrary` dentro do bloco que `NO` pula; nada os importa estaticamente. Original guardado em
  `C:\tree of savior servers\client.xml.bak-usesteam-yes`.
- **`release\patch\updater.config.xml`**: a URL `Revisions` é usada só pelo `packet::CheckClient` (busca
  `partial/data.revision.txt` e `partial/release.revision.txt` por HTTP e manda os números ao barrack). Host da IMC
  morto → manda 0/0; o servidor aceita. `Notice`/`Home` são do `tos.exe` (updater antigo), ignorados pelo cliente.
- **Runtimes**: os seis arquivos do passo 4 vieram de `ClassicV1\_CommonRedist` (a pasta que o `excludes` tira do
  release): `vcredist\vcredist_v14.x86.exe` (14.51.36247, mais novo que o `VC_redist.x86.exe` ao lado, 14.50)
  copiado como `vc_redist.x86.exe`, e `DirectX\Jun2010\` para os cinco do DirectX. Pasta montada em
  `C:\tree of savior servers\redist-publish`; publicada em 2026-09-06.

## Avisos conhecidos

- **SmartScreen**: instalador sem assinatura mostra "Windows protegeu seu PC" → documente o clique em
  "Mais informações → Executar assim mesmo" no site; um certificado de code signing resolve (v1.x).
- **Pasta do launcher**: o instalador só escolhe `C:\Hyped Games\Yufa Launcher` quando não há instalação
  anterior no registro (`appId` `br.com.yufa.launcher`, inalterado). Um launcher 1.0.x instalado antes desta
  mudança continua se atualizando **na pasta onde está**; para movê-lo é desinstalar e instalar de novo, uma vez.
  O nome do produto também mudou para "Yufa Launcher", e com ele a pasta de settings em `%APPDATA%`: nesse
  mesmo upgrade as configurações voltam ao padrão e o launcher procura o jogo ao lado dele e em
  `C:\Hyped Games\ToS Classic`; se o jogo está em outra pasta, aparece o painel de instalação e o jogador
  aponta a pasta em Procurar (vira "Continuar instalação" e o `check` só confere, nada é baixado de novo).
- Self-update tenta download **diferencial** (blockmap) e cai para download completo se o host não
  suportar multipart ranges — comportamento verificado e aceitável (~100 MB por update de launcher).
- **Uploads da máquina do operador para a Cloudflare corrompem sem WARP** (Wi-Fi MediaTek MT7927 + Comcast,
  peering direto com a Cloudflare no hop 7): qualquer upload HTTPS sustentado para a rede da Cloudflare (R2,
  `speed.cloudflare.com`, hosts atrás da Cloudflare) falha com `bad record mac` / `SEC_E_MESSAGE_ALTERED` entre
  10 e 180 MB; uploads para a AWS e todos os downloads são limpos. Não é Node, TLS 1.2/1.3, concorrência, taxa,
  IPv4/IPv6 nem MTU. **Com o Cloudflare WARP conectado, tudo passa** (60 MB em 9 s, release inteiro limpo).
  Antes de `release`, `redist push` ou `launcher`: `warp-cli status` → `Connected`. Sonda de 1 minuto: PUT de
  60 MB com `curl.exe --aws-sigv4` numa chave `_probe/…` (apague depois; o `gc` não mexe nela). Alternativa se o
  WARP falhar: rodar o CLI do droplet (`auth`, `209.38.79.184`).
  `YUFA_PART_MIB` / `YUFA_UPLOAD_QUEUE` ajustam tamanho e paralelismo das partes multipart (padrão 64 MiB × 4).

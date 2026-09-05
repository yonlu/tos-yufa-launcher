# Go-live — Yufa ToS Classic Launcher

Estado atual: **tudo funciona localmente de ponta a ponta** (testes: `npm test`, 60 verdes; fluxo real
verificado com `tools/e2e-setup.ts` + `tools/dev-server.ts`, inclusive self-update 1.0.0 → 1.0.1 e um
clone estrutural do cliente real). O que falta é só a infraestrutura real (R2) e duas decisões.

## Decisão 1 — os 14 patches customizados

O `patch\` real tem 130 ipfs oficiais (≤ 234929) **+ 14 patches customizados do servidor**
(`1116001…1140001_001001.ipf`, ~149 MB — é assim que o conteúdo custom é distribuído hoje).
No `seed`, decida:

- **Recomendado: `--include` os 14.** O launcher passa a gerenciá-los (verificar/reparar/rollback) e o
  `release.revision.txt` passará a dizer `1140001`. O cliente comprovadamente tolera patches acima da
  revisão gravada; ainda assim, teste um login depois do primeiro `check` para confirmar que nada no
  servidor valida esse arquivo. **Todo patch novo precisa ser numerado acima de 1140001.**
- Alternativa: `grandfatherRevision: 1140001` no `publish.config.json` — os 14 viram "conteúdo base"
  (fora do launcher), zero risco, mas sem reparo/rollback para eles.

## Decisão 2 — domínio

Escolha o domínio público do patch (ex.: `patch.yufa.com.br`) e substitua `REPLACE_WITH_DOMAIN` /
`REPLACE_WITH_ACCOUNT_ID` em:

- `publish.config.json` (`endpoint`, `publicBaseUrl`)
- `packages/launcher/src/main/constants.ts` (`MANIFEST_URL`, `LAUNCHER_FEED_URL`)
- `packages/launcher/electron-builder.yml` (`publish.url`)

## Passos

1. **Cloudflare R2**: crie o bucket (`yufa-patch`), um token de API (Object Read & Write) e conecte o
   domínio customizado ao bucket. Egress é gratuito; R2 responde HTTP Range (necessário p/ resume).
   Confirme depois do deploy: `curl -r 0-1023 -sw '%{http_code}' https://patch.<dominio>/patches/<arquivo>` → `206`.
   Os uploads do CLI já mandam `Cache-Control` correto (`immutable` p/ ipfs, `no-cache` p/ manifest/news/latest.yml);
   se usar cache do Cloudflare, crie uma Cache Rule de bypass para `manifest.json`, `news/*` e `launcher/latest.yml`.
2. **Credenciais**: `$env:R2_ACCESS_KEY_ID` / `$env:R2_SECRET_ACCESS_KEY` (nunca no repo).
3. **Release** (primeiro Build):
   `npx tsx packages/publish-cli/src/index.ts release --dir C:\tos-servers\Classic --label 1.0`
   (use `--dry-run` antes; depois `verify --mirror C:\tos-servers\Classic`, que confere cada Blob no bucket e
   cada hash contra a pasta local). De tempos em tempos, `gc --keep 3 --dry-run` e então `gc --keep 3` para apagar
   Blobs que nenhum dos 3 Builds mais recentes (nem o atual) referencia. Nunca rode `gc` com um `release`/`patch`
   em andamento: os Blobs subem antes do Manifest que os referencia.
4. **Notícias**: edite `news/news.json` → `… news push`.
5. **Launcher**: `npm run dist -w @yufa/launcher` → teste o instalador → `… launcher packages/launcher/release-builds`.
   Publique o `Yufa-Launcher-Setup-1.0.0.exe` no site no lugar do GameUpdater antigo.
6. **Teste de aceitação final** (única coisa que não dá para validar sem o jogo): crie um ipf de teste
   com um recurso visível alterado (ferramentas da comunidade, linhagem IPFUnpacker — confirme que o
   ipf gerado funciona neste build do cliente), numere `1140002_001001.ipf`, `… patch <arquivo>`, rode o
   launcher numa CÓPIA do cliente, entre no jogo e confirme o recurso; depois `… rollback 1140001` e
   confirme que o arquivo some e o recurso volta.

## Rotina de operação

- Publicar patch: autorar ipf → nomear `<rev>_001001.ipf` (rev > atual) → `… patch <arquivo>` (sobe o
  objeto primeiro, manifest por último — nunca há janela de 404).
- Desfazer: `… rollback <rev>` (clientes apagam os arquivos removidos sozinhos).
- Atualizar launcher: bump `version` no `packages/launcher/package.json` → `npm run dist` →
  `… launcher <dist>` (+ `--min-launcher <ver>` para forçar update).

## Avisos conhecidos

- **SmartScreen**: instalador sem assinatura mostra aviso "Windows protegeu seu PC" → documente o
  clique em "Mais informações → Executar assim mesmo" no site; um certificado de code signing resolve (v1.x).
- Self-update tenta download **diferencial** (blockmap) e cai para download completo se o host não
  suportar multipart ranges — comportamento verificado e aceitável (~100 MB por update de launcher).
- Diretório de instalação atual: `%LOCALAPPDATA%\Programs\@yufalauncher` (cosmético; vem do nome do pacote npm).
- Teste local completo a qualquer momento:
  `npx tsx tools/e2e-setup.ts --base <dir>` → `npx tsx tools/dev-server.ts --root <dir>\store --port 8787` →
  rode o launcher com `YUFA_MANIFEST_URL`, `YUFA_GAME_DIR`, `YUFA_USERDATA`, `YUFA_AUTO=update|play`, `YUFA_SCREENSHOT`.

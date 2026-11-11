# 5W2H Finanças

Aplicativo pessoal, privado e somente para leitura, com importação e sincronização manual dos planos do YNAB. O frontend é uma PWA React/Vite em TypeScript. O Cloudflare Worker serve a interface e a API; D1 mantém o modelo consultável e o JSON original dos recursos importados.

## Desenvolvimento local

```sh
npm install
npm run cf:types
npm run dev
```

O Vite fica em `http://127.0.0.1:5173` e encaminha `/api` ao Worker local em `http://127.0.0.1:8787`. Crie `.dev.vars` localmente com `YNAB_PAT=...` para carregar seus planos do YNAB. Esse arquivo é ignorado pelo Git.

## Verificações

```sh
npm run lint
npm test
npm run build
```

## Cloudflare

O Worker usa Workers Static Assets, D1 e Cloudflare Access. O PAT deve ser cadastrado como secret do Worker por `cf`, nunca como variável comum, arquivo versionado ou dado do navegador. Mantenha `ACCESS_ISSUER` e `ACCESS_AUD` alinhados com a aplicação Access que protege o Worker.

```sh
npm run deploy:dry
npm run deploy
```

O ambiente pessoal já está provisionado: o Worker `5w2h`, a base D1 e a aplicação Access ficam na conta Cloudflare. A migração inicial está aplicada e o PAT está salvo como secret do Worker. Em uma conta nova, crie a base D1, aplique `migrations/` com `cf d1 migrations apply <database-id> --dir migrations`, configure Access para o Worker e ajuste `ACCESS_ISSUER` e `ACCESS_AUD` em `cloudflare.config.ts` antes do deploy.

O deploy automático ainda não está conectado ao GitHub. Configure a integração Workers Builds no painel Cloudflare para acompanhar a branch `main`; não há token de deploy versionado no repositório.

Endereço privado: <https://5w2h.pedrobrown.workers.dev/>.

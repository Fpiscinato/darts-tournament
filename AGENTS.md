# Darts Tournament Manager — AGENTS.md

> Leia `README.md` e `SECURITY.md` antes de alterar o projeto.

## Arquitetura (resumo)

- PWA estática e offline-first: React + TypeScript + Vite + Tailwind + shadcn/ui,
  dados no navegador via IndexedDB/Dexie.
- Sem servidor, sem login, sem backend, sem sincronização entre dispositivos.
- Exportação/importação de backup em JSON local, sem criptografia.

## Comandos

```bash
npm run dev     # Vite dev server
npm run build   # tsc -b && vite build
npm run lint    # oxlint
npm run test    # vitest
```

## Segurança (não negociável)

- Nunca commitar `.env`, `.env.*`, `opencode.json`, `.dev.vars`, `*.key`, `*.pem` ou
  qualquer token. O `.gitignore` já bloqueia; nunca usar `git add -f` nesses ficheiros.
- Não introduzir backend, telemetria ou chamadas de rede em runtime: o app deve
  continuar 100% local (ver `SECURITY.md`).
- Antes de cada push: `git status --short` + `git diff --cached`. Se um segredo vazar,
  revogue primeiro e só depois limpe o histórico.

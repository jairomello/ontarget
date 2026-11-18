# Tasks

## 1. Persistência de contas

- [x] 1.1 Adicionar `users`, `sessions` e `api_keys` ao `apps/server/src/db/schema.ts` (e-mail único, FKs em cascata, `ts`/`bool` das convenções) e verificar com `bun run typecheck`
- [x] 1.2 Gerar a migração `0005_accounts` com `bun run --cwd apps/server db:generate` e verificar que ela cria as três tabelas e os índices únicos em `users.email`, `sessions.token_hash` e `api_keys.key_hash`
- [x] 1.3 Criar `apps/server/src/services/accounts.ts` com normalização de e-mail (trim + minúsculas), CRUD de usuário, hash/verificação de senha com `Bun.password` e regra de política (mínimo 10) e verificar com testes de unidade
- [x] 1.4 Criar `apps/server/src/services/sessions.ts` (emitir, resolver por token com hash, renovação deslizante de 1 dia, revogar por id e por usuário) e verificar com testes de unidade, incluindo sessão expirada
- [x] 1.5 Implementar `verifyApiKey` em `apps/server/src/services/apiKeys.ts` (geração `ont_` + 32 bytes, SHA-256, recusa de revogada/desconhecida, atualização de último uso) e verificar com testes de unidade
- [x] 1.6 Escrever os testes de contrato de banco (`apps/server/tests/accounts.test.ts`) cobrindo e-mail duplicado, cascata ao apagar usuário e sessão revogada

## 2. HTTP de autenticação e proteção das rotas

- [x] 2.1 Criar `apps/server/src/middleware/auth.ts` que resolve o cookie `ontarget_session`, anexa o usuário ao contexto e responde 401 `{ error: { code: "unauthorized" } }` e verificar com teste de contrato
- [x] 2.2 Criar `apps/server/src/routes/auth.ts` com `GET /state`, `POST /setup` (409 depois do primeiro usuário), `POST /login` (cookie + mensagem genérica), `POST /logout` e `GET /me` e verificar com testes de contrato de cada caso
- [x] 2.3 Implementar limite de tentativas de login (janela de 15 min, bloqueio com 429 e tempo restante) e verificar com teste que simula tentativas repetidas
- [x] 2.4 Adicionar `PATCH /api/users/me` (nome e preferências com validação) e `PATCH /api/users/me/password` (senha atual, revogação das outras sessões) e verificar com testes de contrato
- [x] 2.5 Montar o middleware em `createApp` antes das rotas de projeto, liberando apenas `/api/health` e `/api/auth/*`, e verificar com teste que `/api/projects` responde 401 sem cookie e 200 com cookie
- [x] 2.6 Criar `apps/server/tests/helpers/auth.ts` e adaptar as suítes existentes (`projects`, `sync`, `import`, `snapshots`, `changeLog`) para autenticar, verificando que `bun test` segue verde
- [x] 2.7 Verificar exigência de `Content-Type: application/json` nas rotas de escrita (exceto o multipart do avatar) com teste de contrato

## 3. Infraestrutura de testes E2E

- [x] 3.1 Ajustar o script `e2e:server` para recriar `data/e2e.db` a cada execução e verificar que dois `bun run test:e2e` seguidos partem do mesmo estado
- [x] 3.2 Criar `globalSetup` que aguarda `/api/health`, cria a conta inicial via `/api/auth/setup` e salva `e2e/.auth/user.json`, e configurar `use.storageState` no `playwright.config.ts`
- [x] 3.3 Adicionar `e2e/.auth/` ao `.gitignore` e verificar que o arquivo de sessão não aparece no `git status`
- [x] 3.4 Rodar a suíte E2E existente inteira e corrigir o que depender de sessão, verificando `52 passed`

## 4. Chaves de API (servidor)

- [x] 4.1 Criar `apps/server/src/routes/apiKeys.ts` com `GET`, `POST` e `DELETE /:id`, validação de nome (1–100) e resposta sem hash/valor e verificar com testes de contrato
- [x] 4.2 Garantir anti-IDOR: revogar chave de outro usuário responde 404 e não altera nada, verificado por teste com duas contas
- [x] 4.3 Verificar que o valor completo aparece só na resposta de criação e que `GET` nunca devolve valor nem hash, com teste de contrato

## 5. Foto de perfil (servidor)

- [x] 5.1 Implementar `PUT /api/users/me/avatar` com multipart, validação por *magic bytes* e limite de 512 KB, gravando em `data/uploads/avatars/<userId>.webp` e verificar com testes de contrato (válido, tipo inválido, grande demais)
- [x] 5.2 Implementar `GET /api/users/me/avatar` com `ETag` e `DELETE` que apaga o arquivo e limpa `avatar_path`, verificado por testes de contrato
- [x] 5.3 Garantir que `data/uploads/` está ignorado no git e que apagar o usuário remove o arquivo, verificado por teste

## 6. Cliente de autenticação

- [x] 6.1 Criar `apps/web/src/features/auth/AuthContext.tsx` (estado, login, logout, refresh de `/me`) e `RequireAuth` com redirecionamento para `/login?next=`, verificado por teste de componente
- [x] 6.2 Criar as rotas `/login` e `/primeiro-acesso` com validação de campos e mensagens de erro genéricas, verificado por testes de componente
- [x] 6.3 Interceptar 401 nas chamadas de dados para limpar a sessão e voltar ao login preservando a rota, verificado por teste de unidade do cliente HTTP
- [x] 6.4 Adicionar E2E `e2e/auth.e2e.ts` cobrindo primeiro acesso, logout, login, senha errada e bloqueio de `/` sem sessão, verificando que a suíte passa

## 7. Menu de perfil e página de conta

- [x] 7.1 Criar `ProfileMenu` na barra do aplicativo (avatar/iniciais, nome, e-mail, ações) com fechamento por clique fora e `Esc` e navegação por teclado, verificado por teste de componente
- [x] 7.2 Criar a rota `/conta` com as seções perfil, senha, aparência e chaves, reaproveitando o shell, verificado por teste de componente
- [x] 7.3 Implementar edição do nome de exibição com validação 1–200 e e-mail somente leitura, verificado por teste de componente e E2E
- [x] 7.4 Implementar upload com recorte (canvas 256×256, WebP) e remoção da foto, verificado por teste de unidade do recorte e E2E de envio/remoção
- [x] 7.5 Implementar a seção de chaves no cliente (criar, copiar uma vez, listar com último uso, revogar com confirmação), verificado por E2E `e2e/api-keys.e2e.ts`
- [x] 7.6 Adicionar E2E `e2e/profile.e2e.ts` cobrindo abrir o menu, ir para a conta, salvar nome, trocar senha e sair, verificando que a suíte passa

## 8. Aparência: paletas e preferências por conta

- [x] 8.1 Adicionar `palette` a `theme.ts`/`uiStore` e o atributo `data-palette` em `applyAppearance`, verificado por teste de unidade
- [x] 8.2 Definir em `tokens.css` as paletas `indigo`, `emerald`, `amber`, `slate` e `violet` (tokens de identidade em claro e escuro) e verificar com teste que todas definem o mesmo conjunto de tokens nos dois temas
- [x] 8.3 Adicionar teste de contraste que garanta `--accent-fg` sobre `--accent` ≥ 4,5:1 em todas as paletas e temas
- [x] 8.4 Sincronizar `useAppearance` com `/api/auth/me` e `PATCH /api/users/me`, mantendo `localStorage` como cache e restaurando o valor anterior em falha, verificado por testes de unidade
- [x] 8.5 Mover os seletores de tema e densidade da barra superior para o menu de perfil, mantendo `data-testid="theme-select"` e `data-testid="density-select"`, e atualizar `e2e/shell.e2e.ts` junto com os testes de tema, verificando que a suíte passa
- [x] 8.6 Adicionar E2E de paleta que troca a paleta, recarrega a página e confirma que a escolha persistiu na conta

## 9. Documentação e operação

- [x] 9.1 Criar `scripts/reset-password.ts` (`bun run auth:reset`) que redefine a senha direto no SQLite local e verificar executando contra um banco temporário
- [x] 9.2 Atualizar `docs/PRD.md` (RF-P04 e premissa de usuário único), `docs/architecture.md` (§1, §4, rotas e tabelas) e `docs/guia-de-uso.md` (primeiro acesso, conta, chaves, redefinição local), verificando que os comandos citados executam como escritos
- [x] 9.3 Rodar `bun run typecheck`, `bun test` e `bun run test:e2e` completos e confirmar tudo verde antes de pedir revisão

## Workflow follow-up

- Arquivar `add-user-profile` depois da revisão, conferindo que o delta de `ui-shell` foi aplicado sobre a capability da fundação.
- Sincronizar as specs principais e validar com `openspec validate --strict`.

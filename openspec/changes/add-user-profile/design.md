# Design

## Context

O ontarget é um monorepo Bun com Hono + Drizzle/SQLite no servidor e React + Zustand no
cliente. Hoje não existe identidade: `createApp` monta apenas `/api/health` e
`/api/projects`, e a aparência (tema/densidade) vive no `localStorage` (`useAppearance`).
Os testes de contrato chamam `app.fetch` sem credencial e os 52 E2E usam `request`/`page`
diretamente. Ver `proposal.md` para a motivação; este documento fixa as escolhas técnicas.

## Goals / Non-Goals

**Goals:**

- Autenticação local simples de operar e de testar, sem serviço externo nem dependência nova.
- Preferências por conta com boot instantâneo (cache local) e verdade no servidor.
- Chaves de API verificáveis por uma função única que o futuro servidor MCP reutiliza.
- Preservar o comportamento do app para quem já usa: mesmos `data-testid`, mesmos fluxos.

**Non-Goals:**

- Multiusuário colaborativo, papéis/permissões e dono por projeto.
- Recuperação de senha por e-mail, MFA, OAuth.
- Servidor MCP (apenas emissão/verificação de credenciais).
- Migrar dados existentes para um dono: projetos continuam globais à instalação.

## Decisions

### Contas locais com sessão opaca no banco

`users(id, email, name, password_hash, avatar_path, theme, density, palette, created_at,
updated_at)` com e-mail normalizado em minúsculas e índice único. Sessões em
`sessions(id, token_hash, user_id, created_at, expires_at, last_seen_at)`.

- Token de sessão: 32 bytes aleatórios em base64url, guardado como SHA-256; o cookie carrega
  o valor bruto. Isso permite revogação imediata (requisito) sem varrer todos os registros.
- Cookie `ontarget_session`: `httpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` de 30 dias,
  `Secure` apenas quando a requisição chega por HTTPS (instalação local roda em HTTP).
- Renovação deslizante: `expires_at` é estendido no máximo uma vez por dia, para não escrever
  no banco a cada requisição.

Alternativas descartadas: **JWT** (revogação exigiria lista negra, mesma tabela); **sessão em
memória** (perde o login a cada reinício do processo).

### Senha com `Bun.password`

`Bun.password.hash`/`verify` (Argon2id, padrão do runtime) — sem adicionar `bcrypt` ou
`argon2` nativos. Política: mínimo 10 caracteres, confirmação obrigatória, comparação com a
senha atual na troca. Troca revoga as outras sessões (`DELETE ... WHERE user_id = ? AND id <> ?`).

Alternativa descartada: `bcrypt` como no azyboard — exigiria dependência nativa sem ganho.

### Primeiro acesso e bloqueio de rotas

`GET /api/auth/state` (público) devolve `{ needsSetup }` contando usuários. Enquanto
`needsSetup` for verdadeiro, a única rota de escrita liberada é `POST /api/auth/setup`, que
cria a conta e abre sessão; depois dela responde 409. `authMiddleware` é montado em `/api/*`
antes das rotas de projeto, liberando apenas `/api/health` e `/api/auth/*`.

No cliente, `AuthProvider` busca `/api/auth/me` no boot e `<RequireAuth>` decide entre
`/login`, `/primeiro-acesso` e a rota pedida. Qualquer resposta 401 de uma chamada de dados
limpa o estado e redireciona para `/login?next=<rota>`, preservando a intenção do usuário.
O upload multipart (`/api/users/me/avatar`) é a única rota de escrita fora do
`application/json`; as demais exigem JSON para reduzir CSRF além do `SameSite=Lax`.

### Contas não são donas de projetos

Projetos permanecem globais à instalação (sem `owner_id`). Criar contas agora não é criar
workspaces: qualquer conta autenticada vê o mesmo portfólio. Isso evita migração de dados e
mantém as specs de persistência intactas; propriedade por projeto fica para uma change futura.

### Chaves de API com hash rápido e prefixo

`api_keys(id, user_id, name, key_hash, created_at, last_used_at, revoked_at)`.
Valor = `ont_` + base64url(32 bytes). Como a chave já tem 256 bits de entropia, SHA-256 basta
(mesma escolha do azyboard); Argon2 fica só para senhas. `verifyApiKey(raw)` devolve o usuário
dono, atualiza `last_used_at` e recusa revogadas/desconhecidas de forma indistinguível.
O `authMiddleware` **não** aceita chave de API nas rotas humanas — só a função de verificação
é compartilhada, para o futuro endpoint MCP. Nome da chave é validado (1–100 caracteres).

### Foto: recorte no cliente, arquivo no disco

Fluxo: `<input type=file>` → canvas (recorte quadrado, saída WebP 256×256, qualidade 0.9) →
`PUT /api/users/me/avatar` multipart. O servidor valida tipo por *magic bytes*, tamanho
≤ 512 KB e grava `data/uploads/avatars/<userId>.webp`; `GET /api/users/me/avatar` serve o
arquivo com `ETag` derivado de `updated_at`. `DELETE` apaga o arquivo e limpa `avatar_path`.
Sem foto, o avatar é gerado das iniciais (primeira e última palavra do nome).

Alternativas descartadas: **BLOB no SQLite** (incha o banco e os snapshots de backup);
**normalização no servidor** (exigiria `sharp`, dependência nativa).

### Preferências no usuário + cache local

`theme`, `density` e `palette` são colunas de `users` (não uma tabela `preferences`: são três
campos fixos). `useAppearance` continua lendo `localStorage` (`ontarget.appearance`, agora com
`palette`) para aplicar a aparência antes do primeiro fetch e, quando `/api/auth/me` responde,
adota a preferência do servidor. Alterações fazem `PATCH /api/users/me` e só então atualizam o
cache; falha restaura o valor anterior e mostra aviso.

### Paletas como variáveis CSS

`data-palette` no `<html>`, ao lado de `data-theme`/`data-density`. Cada paleta sobrescreve
apenas os tokens de identidade (`--accent`, `--accent-soft`, `--accent-fg`, `--brand-*`,
`--bar-task*`), nos blocos claro e escuro. Paletas iniciais: `indigo` (padrão), `emerald`,
`amber`, `slate` e `violet`. Um teste de unidade lê `tokens.css` e garante que toda paleta
define o mesmo conjunto de tokens em ambos os temas e que `--accent-fg` sobre `--accent`
mantém contraste ≥ 4,5:1.

### Testes: sessão como fixture

- Contrato: novo `apps/server/tests/helpers/auth.ts` cria usuário + sessão e devolve cookie;
  as suítes existentes passam a chamar `createApp` e enviar o cookie. `createApp` não ganha
  flag de "auth desligada" — mascarar o middleware esconderia regressões.
- E2E: `globalSetup` recria `data/e2e.db` (o script `e2e:server` deixa de reutilizar banco
  velho), cria a conta inicial via API e salva `storageState` em `e2e/.auth/user.json`; o
  `use.storageState` do config injeta o cookie em todos os testes, inclusive nas chamadas do
  fixture `request`, que compartilha o contexto do navegador.
- Testes novos: primeiro acesso, login/limite, troca de senha, avatar, preferências e chaves.

### Migração

Uma migração Drizzle (`0005_accounts`) cria `users`, `sessions` e `api_keys` com FKs em
cascata. Instalações existentes ficam com `needsSetup = true` e são guiadas pelo primeiro
acesso; nenhum dado de projeto é tocado. Rollback: reverter a migração e o middleware; os
arquivos de avatar em `data/uploads/` podem ser apagados sem afetar projetos.

## Risks / Trade-offs

- **Quebrar todos os testes e clientes que chamam a API sem credencial** → helper de sessão
  nos testes de contrato, `storageState` nos E2E e execução completa (`bun test` + Playwright)
  antes de considerar a change pronta.
- **Senha esquecida sem e-mail de recuperação** → script local `bun run auth:reset`
  (`scripts/reset-password.ts`) que grava novo hash direto no SQLite, documentado no
  `docs/guia-de-uso.md`.
- **Limite de tentativas em memória** → reiniciar o processo zera o contador. Aceitável para
  instalação local de processo único; documentado no código.
- **Ordem de arquivamento do OpenSpec**: o delta de `ui-shell` depende da capability criada
  por `specify-e-project-v1`. Arquivar a fundação antes desta change.
- **Cache local divergente do servidor** (outro navegador mudou a paleta) → o `/api/auth/me`
  do boot sobrescreve o cache; a janela de divergência é de um carregamento.
- **Contas sem isolamento de projeto** pode surpreender quem espera workspaces → decisão
  explícita neste documento e no guia de uso.

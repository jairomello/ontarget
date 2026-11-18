# Proposal

## Why

O ontarget nasceu como aplicação local de usuário único, sem identidade: tema e densidade
vivem só no `localStorage` e não há como distinguir quem opera o app. Isso impede três coisas
que já são pedidas na prática — proteger o acesso com senha, manter preferências que
acompanhem a conta e emitir credenciais para agentes externos (MCP). O azyboard já resolve
esse conjunto com um menu de perfil no canto direito; esta change traz o mesmo padrão para o
ontarget, adaptado a uma instalação local.

## What Changes

- **BREAKING**: introduz contas locais. Toda rota `/api/*` (exceto saúde e autenticação) passa
  a exigir sessão; sem sessão, o cliente é redirecionado para o login.
- Primeiro acesso: quando não existe nenhum usuário, o app oferece a criação da conta
  inicial (e-mail, nome e senha); depois disso, apenas login.
- Login/logout com sessão por cookie `httpOnly`, senha com hash Argon2id e limite de tentativas.
- Menu de perfil no canto direito da barra do aplicativo: avatar, nome e e-mail, atalhos para
  perfil, preferências, chaves de API e sair.
- Página de conta (`/conta`) com seções de perfil (nome e foto), senha, aparência e chaves.
- Foto de perfil: upload com recorte no navegador, avatar por iniciais como fallback e remoção.
- Troca de senha exigindo a senha atual, com política mínima de comprimento.
- Aparência por conta: tema (claro/escuro/automático), densidade e **paletas de cor**
  adicionais, persistidos no servidor e cacheados no navegador para boot instantâneo.
- Os seletores de tema e densidade saem da barra superior e passam a viver no menu de perfil,
  mantendo os mesmos `data-testid` para não quebrar a automação existente.
- Chaves de API para MCP: gerar, listar (nome, criação, último uso) e revogar; a chave é
  exibida uma única vez e guardada apenas como hash.
- Documentação: PRD/arquitetura deixam de afirmar "single-user local sem autenticação" e
  passam a descrever contas locais.

Fora de escopo: servidor MCP funcional, multiusuário simultâneo, compartilhamento de projetos
entre contas, login por provedor externo/OAuth e recuperação de senha por e-mail.

## Capabilities

### New Capabilities

- `user-auth`: primeiro acesso, login/logout, sessão por cookie, proteção das rotas de API,
  política de senha e troca de senha pelo próprio usuário.
- `user-profile`: menu de perfil na barra do aplicativo, página de conta, nome de exibição,
  foto com recorte e preferências de aparência por conta.
- `api-keys`: emissão, listagem e revogação de chaves de API para agentes MCP, com exibição
  única e armazenamento apenas do hash.

### Modified Capabilities

- `ui-shell`: a aparência ganha paletas de cor além de claro/escuro e os controles de tema e
  densidade passam a ser acessados pelo perfil, não pela barra superior.

## Impact

- **Banco**: novas tabelas `users`, `sessions` e `api_keys` (migração `0005`), com índices
  únicos por e-mail, token de sessão e hash de chave.
- **Servidor**: middleware de sessão em `/api/*`; novas rotas `/api/auth/*`, `/api/users/me*`
  e `/api/api-keys`; `createApp` passa a montar o middleware antes das rotas de projeto.
- **Cliente**: `AuthContext`, guarda de rotas, telas `/login`, `/primeiro-acesso` e `/conta`,
  `ProfileMenu` na barra, `useAppearance` passa a sincronizar com o servidor.
- **Testes**: os testes de contrato e E2E existentes passam a autenticar antes de chamar a
  API; novos testes cobrem primeiro acesso, senha, avatar, preferências e chaves.
- **Dependências**: nenhuma nova — hash com `Bun.password`, sessão e chaves com
  `node:crypto`; recorte da foto no `canvas` do navegador.
- **Documentação**: `docs/PRD.md` (RF-P04 e premissa de usuário único), `docs/architecture.md`
  (§1, §4 e rotas) e `docs/guia-de-uso.md`.

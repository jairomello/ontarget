# Spec Delta

## Purpose

Define como o ontarget identifica quem opera o aplicativo: criação da conta inicial,
entrada e saída, duração e renovação da sessão, proteção das rotas de API e troca de senha.

## ADDED Requirements

### Requirement: Criação da conta inicial
Enquanto não existir nenhum usuário, o sistema SHALL oferecer a criação da conta inicial com
e-mail, nome e senha, e SHALL autenticar essa conta ao concluir o cadastro. A partir do
primeiro usuário criado, o cadastro público SHALL ficar indisponível.

#### Scenario: Primeiro acesso em banco vazio
- **WHEN** o aplicativo é aberto e não há usuários cadastrados
- **THEN** a tela de primeiro acesso pede e-mail, nome e senha e, ao concluir, abre o portfólio já autenticado

#### Scenario: Cadastro indisponível depois do primeiro usuário
- **WHEN** já existe uma conta e alguém tenta criar outra pela API de primeiro acesso
- **THEN** o sistema responde 409 e mantém a exigência de login

### Requirement: Entrada com e-mail e senha
O sistema SHALL autenticar por e-mail e senha, comparando o e-mail sem diferenciar
maiúsculas de minúsculas e validando a senha contra o hash armazenado. Credenciais
inválidas SHALL produzir a mesma mensagem genérica, sem revelar se o e-mail existe.

#### Scenario: Credenciais corretas
- **WHEN** o usuário informa e-mail e senha válidos
- **THEN** o sistema cria a sessão e abre a tela solicitada

#### Scenario: Senha incorreta
- **WHEN** a senha não confere com o hash da conta
- **THEN** o sistema responde 401 com mensagem genérica e não cria sessão

#### Scenario: E-mail sem conta
- **WHEN** o e-mail informado não pertence a nenhuma conta
- **THEN** a resposta é idêntica à de senha incorreta, sem indicar que o e-mail não existe

### Requirement: Limite de tentativas de entrada
O sistema SHALL limitar tentativas de login malsucedidas por e-mail e por origem, bloqueando
temporariamente novas tentativas após um limite configurável e informando o tempo de espera.

#### Scenario: Excesso de tentativas
- **WHEN** ocorrem tentativas inválidas repetidas dentro da janela de limite
- **THEN** novas tentativas respondem 429 com o tempo restante até liberar

### Requirement: Sessão por cookie
O sistema SHALL manter a sessão em cookie `httpOnly`, `SameSite=Lax`, com validade padrão de
30 dias, renovando-a a cada uso autenticado e invalidando-a no logout.

#### Scenario: Sessão válida
- **WHEN** o cliente envia o cookie de uma sessão não expirada
- **THEN** a requisição é atendida como o usuário da sessão

#### Scenario: Logout
- **WHEN** o usuário sai pelo menu de perfil
- **THEN** a sessão é revogada no servidor e o cookie é apagado, e novas requisições são recusadas

#### Scenario: Sessão expirada
- **WHEN** o cookie corresponde a uma sessão expirada ou revogada
- **THEN** a API responde 401 e o cliente volta ao login sem perder a rota pretendida

### Requirement: Proteção das rotas de API
O sistema SHALL exigir sessão válida em todas as rotas `/api/*`, exceto saúde, metadados de
primeiro acesso e as próprias rotas de autenticação, respondendo 401 no formato de erro da API.

#### Scenario: Chamada sem sessão
- **WHEN** uma requisição chega a `/api/projects` sem cookie válido
- **THEN** a resposta é 401 com código `unauthorized` e nenhum dado de projeto é retornado

#### Scenario: Rota pública
- **WHEN** o cliente consulta `/api/health` ou o estado de primeiro acesso sem sessão
- **THEN** a resposta é 200

### Requirement: Política de senha
O sistema SHALL aceitar senhas com no mínimo 10 caracteres, exigir confirmação na criação e
na troca, e recusar senhas que não atendam à política com mensagem que explique o critério.

#### Scenario: Senha curta
- **WHEN** o usuário tenta cadastrar ou trocar a senha para uma com menos de 10 caracteres
- **THEN** a operação é recusada com mensagem indicando o tamanho mínimo

#### Scenario: Confirmação divergente
- **WHEN** a confirmação não é idêntica à nova senha
- **THEN** a operação é recusada e nenhum campo é alterado

### Requirement: Troca de senha pelo próprio usuário
O sistema SHALL permitir que o usuário autenticado troque a própria senha informando a senha
atual, mantendo a sessão corrente ativa e revogando as demais sessões da mesma conta.

#### Scenario: Troca bem-sucedida
- **WHEN** o usuário informa a senha atual correta e uma nova senha válida
- **THEN** a senha é atualizada, a sessão atual continua válida e as outras sessões são encerradas

#### Scenario: Senha atual incorreta
- **WHEN** a senha atual informada não confere
- **THEN** a troca é recusada com 401 e a senha permanece inalterada

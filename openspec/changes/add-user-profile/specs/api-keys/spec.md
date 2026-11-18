# Spec Delta

## Purpose

Define as credenciais que o usuário emite para agentes externos (MCP): criação com nome,
exibição única do segredo, listagem sem expor o valor e revogação imediata.

## ADDED Requirements

### Requirement: Emissão de chave de API
O sistema SHALL gerar uma chave de API a partir de um nome obrigatório de até 100 caracteres,
exibir o valor completo uma única vez na criação e guardar apenas o hash da chave.

#### Scenario: Chave criada
- **WHEN** o usuário informa um nome e confirma a criação
- **THEN** o sistema mostra a chave completa uma vez, com ação de copiar, e a lista passa a exibir a nova entrada

#### Scenario: Nome ausente
- **WHEN** o usuário tenta criar uma chave sem nome
- **THEN** a criação é recusada e nenhuma chave é gerada

#### Scenario: Valor não recuperável
- **WHEN** o usuário fecha o diálogo da chave recém-criada
- **THEN** o valor completo deixa de ser exibido em qualquer tela ou consulta

### Requirement: Chaves identificáveis
O sistema SHALL gerar chaves com prefixo fixo `ont_` seguido de segredo aleatório com pelo
menos 32 bytes de entropia, de modo que o valor seja reconhecível e não adivinhável.

#### Scenario: Formato da chave
- **WHEN** uma chave é criada
- **THEN** o valor exibido começa com `ont_` e tem comprimento suficiente para 32 bytes aleatórios

#### Scenario: Chaves distintas
- **WHEN** duas chaves são criadas em sequência
- **THEN** os valores gerados são diferentes

### Requirement: Listagem de chaves
O sistema SHALL listar as chaves do usuário com nome, data de criação e data do último uso,
sem nunca devolver o valor ou o hash da chave.

#### Scenario: Lista com chave usada
- **WHEN** o usuário abre a seção de chaves
- **THEN** cada chave aparece com nome, criação e último uso, ou a indicação de que nunca foi usada

#### Scenario: Lista vazia
- **WHEN** o usuário ainda não criou chaves
- **THEN** a seção mostra o estado vazio com a ação de criar a primeira chave

### Requirement: Revogação de chave
O sistema SHALL revogar uma chave após confirmação explícita e SHALL recusar imediatamente
qualquer verificação posterior dessa chave.

#### Scenario: Revogação confirmada
- **WHEN** o usuário confirma a revogação de uma chave
- **THEN** a chave sai da lista ativa e passa a ser recusada em novas verificações

#### Scenario: Revogação cancelada
- **WHEN** o usuário cancela a confirmação
- **THEN** a chave permanece ativa e nenhum dado muda

### Requirement: Verificação de chave
O sistema SHALL verificar uma chave apresentada comparando seu hash com as chaves ativas,
identificar o usuário dono, atualizar a data de último uso e recusar chaves revogadas ou
desconhecidas com a mesma resposta.

#### Scenario: Chave válida
- **WHEN** uma chave ativa é apresentada em uma rota que aceita credenciais de agente
- **THEN** a requisição é atendida como o usuário dono e o último uso é registrado

#### Scenario: Chave revogada ou desconhecida
- **WHEN** uma chave revogada ou inexistente é apresentada
- **THEN** a resposta é 401, sem distinguir revogada de desconhecida e sem revelar o dono

### Requirement: Orientação de conexão MCP
O sistema SHALL explicar, na seção de chaves, para que serve a chave e como um agente MCP a
utiliza, sem prometer um endpoint que ainda não existe.

#### Scenario: Orientação visível
- **WHEN** o usuário abre a seção de chaves
- **THEN** vê a finalidade da chave e a instrução de usá-la como credencial de agente, com o aviso de que o servidor MCP será disponibilizado em outra entrega

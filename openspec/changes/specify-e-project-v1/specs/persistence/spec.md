# Spec Delta

## Purpose

Garante que todo o trabalho do usuário seja gravado localmente em SQLite de forma confiável, sem perda entre sessões e com recuperação após falhas.

## ADDED Requirements

### Requirement: Gravação automática em lote
O sistema SHALL gravar automaticamente as alterações no banco local com atraso de até 800 ms, enviando apenas as entidades modificadas em um único lote atômico.

#### Scenario: Edição persistida sem ação manual
- **WHEN** o usuário edita uma tarefa e espera o período de gravação
- **THEN** a alteração é persistida e o indicador de estado muda para "Salvo"

#### Scenario: Múltiplas edições em sequência rápida
- **WHEN** o usuário faz várias edições em menos de 800 ms entre elas
- **THEN** as alterações são agrupadas em um único lote e nenhuma é perdida

### Requirement: Gravação idempotente
O sistema SHALL aplicar cada lote como um conjunto de inserções/atualizações por chave primária, de modo que o reenvio do mesmo lote não duplique nem corrompa dados.

#### Scenario: Reenvio após falha de rede
- **WHEN** o envio falha e é reenviado
- **THEN** o banco resulta idêntico ao estado esperado, sem registros duplicados

### Requirement: Nenhum estado editável perdido entre sessões
O sistema SHALL preservar todas as alterações persistidas ao fechar e reabrir a aplicação, inclusive quando o fechamento ocorre durante uma gravação pendente.

#### Scenario: Fechamento abrupto
- **WHEN** a aplicação é encerrada antes de concluir uma gravação pendente
- **THEN** ao reabrir, as alterações já confirmadas estão presentes e as não confirmadas são recuperadas do snapshot mais recente, se existir

### Requirement: Integridade referencial
O sistema SHALL manter as relações entre projeto, tarefas, vínculos, recursos, atribuições e baselines íntegras, removendo registros órfãos em cascata.

#### Scenario: Exclusão em cascata
- **WHEN** uma tarefa é excluída
- **THEN** seus vínculos, atribuições e valores de baseline associados são removidos na mesma transação

### Requirement: Snapshots de recuperação
O sistema SHALL manter até 5 snapshots periódicos por projeto para recuperação após falha, identificados por data e hora.

#### Scenario: Recuperação após corrupção
- **WHEN** o estado atual de um projeto não pode ser aberto
- **THEN** o sistema oferece abrir o snapshot mais recente íntegro, informando a data do snapshot

### Requirement: Histórico de alterações
O sistema SHALL registrar em cada lote gravado quais campos de quais entidades mudaram, com valor anterior, novo valor e data/hora, para alimentar o realce de alterações.

#### Scenario: Consulta do que mudou
- **WHEN** o usuário ativa o realce de alterações com uma data de referência
- **THEN** o sistema identifica os campos alterados desde aquela data a partir do histórico gravado

### Requirement: Falha de gravação é visível
O sistema SHALL sinalizar falha de gravação com aviso persistente e ação de tentar novamente, sem descartar as alterações em memória.

#### Scenario: Banco indisponível
- **WHEN** a gravação falha repetidamente
- **THEN** o indicador de estado exibe "Erro ao salvar" e as alterações permanecem disponíveis na sessão

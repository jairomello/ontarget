# Spec Delta

## Purpose

Define a Task Sheet, a grade de tarefas à esquerda do Gantt, como a superfície primária de edição: células editáveis inline, navegação e atalhos de teclado, colunas e seleção.

## ADDED Requirements

### Requirement: Grade sincronizada com o Gantt
A Task Sheet SHALL exibir as mesmas linhas, na mesma ordem e no mesmo estado de expansão do Gantt, compartilhando seleção e rolagem vertical com ele.

#### Scenario: Navegação espelhada
- **WHEN** o usuário seleciona uma linha na grade
- **THEN** a linha correspondente é destacada no Gantt e ambos rolam em conjunto

### Requirement: Edição inline em qualquer célula
A Task Sheet SHALL permitir editar todo campo visível diretamente na célula, por `F2`, duplo-clique ou digitação direta que substitui o conteúdo atual, sem abrir diálogos.

#### Scenario: Digitação direta em duração
- **WHEN** o usuário seleciona a célula Duração e digita `3d`
- **THEN** o valor é aplicado ao confirmar e a tarefa é reagendada

#### Scenario: Cancelar edição
- **WHEN** o usuário pressiona `Esc` durante uma edição
- **THEN** o valor anterior é restaurado e a célula sai do modo de edição

### Requirement: Confirmação e avanço por teclado
A Task Sheet SHALL confirmar a edição com `Enter` (desce uma linha), `Tab` (avança uma célula), `Shift+Tab` (volta) e `Ctrl+Enter` (confirma mantendo a célula).

#### Scenario: Preenchimento sequencial
- **WHEN** o usuário edita uma célula e pressiona `Tab`
- **THEN** a edição é confirmada e o foco vai para a célula seguinte da linha

### Requirement: Validação sem fechamento silencioso
A Task Sheet SHALL manter a célula em edição com indicação de erro quando o valor for inválido, exibindo o motivo.

#### Scenario: Valor inválido
- **WHEN** o usuário digita uma data impossível e confirma
- **THEN** a célula permanece aberta com borda de erro e o motivo exibido

### Requirement: Colar em lote
A Task Sheet SHALL aceitar colar uma matriz de células (`Ctrl+V` em formato tabular), distribuindo os valores pelas células correspondentes e criando tarefas quando a coluna de destino for o nome, como um único passo de desfazer.

#### Scenario: Colar do Excel
- **WHEN** o usuário cola 10 linhas com nome, início e duração na primeira coluna
- **THEN** 10 tarefas são criadas na posição correta e um único `Ctrl+Z` as remove

### Requirement: Navegação completa por teclado
A Task Sheet SHALL suportar setas, `Home`/`End`, `Ctrl+Home`/`Ctrl+End`, `Page Up`/`Page Down`, `Shift`+setas para estender seleção e `Ctrl+A` para selecionar a coluna ou todas as linhas visíveis.

#### Scenario: Estender seleção
- **WHEN** o usuário mantém `Shift` pressionado e move a seta para baixo
- **THEN** a seleção cresce para incluir as linhas intermediárias

### Requirement: Nenhum atalho durante edição de célula
A Task Sheet SHALL bloquear todos os atalhos de navegação e de hierarquia enquanto uma célula estiver em modo de edição, de modo que `-`, `+`, `Tab` e setas tenham o comportamento do campo.

#### Scenario: Digitar caractere de atalho
- **WHEN** o usuário digita `-` dentro de um campo de texto em edição
- **THEN** o caractere é inserido no texto e a árvore não é recolhida

### Requirement: Estrutura por teclado na grade
A Task Sheet SHALL expor as operações de hierarquia pelos atalhos `Ctrl+Shift+Right`/`Ctrl+Shift+Left`, `Tab`/`Shift+Tab` na primeira coluna, `Alt+↑`/`Alt+↓`, `Insert` e `Ctrl+Insert`, com o mesmo resultado dos comandos de menu.

#### Scenario: Comando equivalente
- **WHEN** o usuário usa o atalho de indentar e depois o item de menu correspondente em outra tarefa
- **THEN** ambos aplicam exatamente o mesmo efeito estrutural

### Requirement: Colunas configuráveis
A Task Sheet SHALL permitir redimensionar, reordenar, ocultar e restaurar colunas, mantendo a coluna de identificação fixa durante a rolagem horizontal e persistindo a configuração na visão.

#### Scenario: Redimensionamento persistido
- **WHEN** o usuário redimensiona uma coluna e troca de visão
- **THEN** a largura configurada é mantida

### Requirement: Estados visuais de linha
A Task Sheet SHALL distinguir visualmente linha selecionada, em edição, resumo, inativa, placeholder, recolhida e crítica, sem depender apenas da cor.

#### Scenario: Leitura em alto contraste
- **WHEN** o usuário ativa o modo de alto contraste
- **THEN** cada estado continua distinguível por ícone, peso de fonte ou padrão além da cor

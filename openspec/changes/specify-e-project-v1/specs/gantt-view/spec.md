# Spec Delta

## Purpose

Define o Gantt Chart, a visualização central do produto: barras, dependências, cabeçalho de escala temporal, zoom contínuo e interações de arrastar-e-soltar, com acabamento visual de primeira classe.

## ADDED Requirements

### Requirement: Barras por tipo de tarefa
O sistema SHALL desenhar cada tarefa com a geometria e o estilo do seu tipo: tarefa comum (retângulo arredondado com preenchimento de progresso), tarefa-resumo (barra com extremidades em seta), marco (losango), tarefa manual (borda tracejada), tarefa inativa (hachurada e apagada), placeholder (contorno tracejado sem preenchimento) e tarefa concluída (preenchida com a cor de sucesso).

#### Scenario: Distinção entre tipos
- **WHEN** os seis tipos de barra são exibidos na mesma tela
- **THEN** cada um é reconhecível isoladamente, em claro e em escuro, com contraste mínimo de 3:1 contra a grade

### Requirement: Cabeçalho de escala temporal
O sistema SHALL exibir um cabeçalho de escala em até três faixas (período grande, unidade principal e unidade menor) com os rótulos alinhados às divisões inteiras do calendário, fixado verticalmente e sincronizado horizontalmente com a grade.

#### Scenario: Faixas por nível de zoom
- **WHEN** o usuário aumenta o zoom suficientemente para exibir horas
- **THEN** o cabeçalho passa a exibir ano › mês › dia com a unidade de hora rotulada

### Requirement: Zoom contínuo
O sistema SHALL oferecer zoom contínuo entre 1,5 e 4.000 pixels por dia, operado por `Ctrl`+scroll centrado no ponteiro, atalhos `Ctrl`+`+`/`Ctrl`+`-`, slider na barra de status e presets (Horas, Dias, Semanas, Meses, Trimestres, Anos).

#### Scenario: Zoom centrado no ponteiro
- **WHEN** o usuário aponta para uma data e amplia com `Ctrl`+scroll
- **THEN** a data sob o ponteiro permanece na mesma posição na tela

#### Scenario: Limites de zoom
- **WHEN** o usuário tenta ultrapassar os limites mínimo ou máximo
- **THEN** o zoom para nos limites sem exibir escala inválida

### Requirement: Ajustar à visão
O sistema SHALL oferecer "Ajustar ao projeto" (`Ctrl+0`) e "Ajustar à seleção" (`Ctrl+1`), escolhendo a unidade de exibição adequada à duração resultante.

#### Scenario: Projeto curto
- **WHEN** o projeto inteiro cabe em menos de 14 dias e o usuário ajusta ao projeto
- **THEN** a escala abre em unidades de dias com as datas legíveis

### Requirement: Sincronização da unidade de exibição
O sistema SHALL derivar a unidade de exibição do zoom quando o usuário não a fixou, e mantê-la fixada até o próximo zoom manual.

#### Scenario: Preset selecionado
- **WHEN** o usuário escolhe o preset "Meses"
- **THEN** a unidade permanece em meses até que ele altere o zoom novamente

### Requirement: Tempo não útil sombreado
O sistema SHALL sombrear sábados, domingos, feriados do calendário ativo e fora do turno de trabalho, incluindo faixas de turno visíveis no zoom de horas.

#### Scenario: Feriado do projeto
- **WHEN** um feriado é cadastrado no calendário do projeto
- **THEN** a coluna correspondente aparece sombreada e rotulada no cabeçalho

### Requirement: Linhas de hoje e de data de status
O sistema SHALL exibir uma linha contínua para a data de hoje e uma linha tracejada para a data de status, com rótulo no cabeçalho, suprimindo a segunda quando coincidem.

#### Scenario: Datas distintas
- **WHEN** a data de status difere de hoje
- **THEN** ambas as linhas aparecem, cada uma com o estilo próprio

### Requirement: Criação de dependência pelo Gantt
O sistema SHALL permitir criar uma dependência arrastando do manipulador da borda de uma barra até a barra alvo, com prévia tracejada durante o arraste e recusa visual em alvo inválido.

#### Scenario: Válido
- **WHEN** o usuário solta o arraste sobre uma barra elegível
- **THEN** o vínculo é criado como FS com lag zero e a cadeia é recalculada

#### Scenario: Inválido
- **WHEN** o usuário solta sobre a própria barra ou descendente
- **THEN** o vínculo não é criado, o alvo pisca em erro e nada é alterado

### Requirement: Mover e redimensionar barras
O sistema SHALL permitir arrastar uma barra para reagendar (com snap na unidade de tempo e guia de data) e arrastar suas bordas para alterar a duração, com rótulo de delta durante o arraste.

#### Scenario: Mover tarefa manual
- **WHEN** o usuário arrasta uma tarefa manual para duas dias depois
- **THEN** a barra é reposicionada, as datas são gravadas e os dependentes são reagendados

#### Scenario: Arrastar tarefa automática
- **WHEN** o usuário arrasta uma tarefa com agendamento automático
- **THEN** o sistema oferece convertê-la para manual ou reagendar apenas os dependentes, sem alterar nada antes da escolha

### Requirement: Destaque da cadeia condutora
O sistema SHALL destacar ao selecionar uma tarefa toda a cadeia de predecessores que determina sua data, reduzindo a opacidade dos demais vínculos.

#### Scenario: Seleção com cadeia longa
- **WHEN** o usuário seleciona uma tarefa com 8 predecessores encadeados
- **THEN** os 8 vínculos condutores aparecem destacados e os demais a 25% de opacidade

### Requirement: Menu de contexto
O sistema SHALL oferecer menu de contexto na área do Gantt com as ações relevantes (inserir tarefa, vincular, definir baseline, inativar, excluir, abrir detalhes) exibindo seus atalhos.

#### Scenario: Clique direito em barra
- **WHEN** o usuário clica com o botão direito em uma barra
- **THEN** o menu é aberto com as ações aplicáveis àquela barra

### Requirement: Escopo de foco próprio
O sistema SHALL manter escopo de foco próprio para o Gantt, alternável com a Task Sheet por `F6`, de modo que `+`/`-` controlem o zoom com foco no Gantt e o recolhimento da hierarquia com foco na grade.

#### Scenario: Alternância de foco
- **WHEN** o usuário alterna o foco para o Gantt e pressiona `+`
- **THEN** o zoom aumenta e nada na hierarquia é alterado

### Requirement: Desempenho de renderização
O sistema SHALL manter no mínimo 60 quadros por segundo durante zoom e rolagem com até 2.000 linhas visíveis, renderizando apenas as linhas e o intervalo de tempo visíveis.

#### Scenario: Zoom em projeto grande
- **WHEN** o usuário dá zoom em um projeto com 5.000 tarefas
- **THEN** o gesto permanece fluido, sem travamentos perceptíveis

### Requirement: Modo de impressão do Gantt
O sistema SHALL oferecer uma visão de impressão do Gantt sem interação, com escala congelada, cabeçalho, rodapé e legenda.

#### Scenario: Pré-visualização
- **WHEN** o usuário abre a impressão
- **THEN** a pré-visualização mostra o Gantt com a escala escolhida e a legenda de cores

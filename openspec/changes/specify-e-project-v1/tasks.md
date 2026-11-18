# Tasks

## 1. Fundação (monorepo, banco, tema, shell)

- [x] 1.1 Criar a estrutura do monorepo Bun (`packages/core`, `packages/shared`, `apps/server`, `apps/web`) com workspaces e TypeScript estrito, verificando que `bun install` e `bun test` executam sem erro
- [x] 1.2 Criar o servidor Hono servindo `/api/health` e o build estático do client, verificando com `curl localhost:PORT/api/health` retornando 200
- [x] 1.3 Implementar o schema Drizzle e a migração inicial de `docs/architecture.md` §4, verificando com um script que lista as tabelas e confirma a presença de `projects`, `tasks`, `task_links`, `resources`, `assignments`, `baselines`, `custom_fields` e `change_log`
- [x] 1.4 Implementar os design tokens (claro/escuro/densidade) em CSS, verificando com teste que o atributo `data-theme` e a variável de altura de linha mudam ao alternar tema/densidade
- [x] 1.5 Construir o shell da aplicação (barra de aplicação, barra de comandos, barra de status, rotas) e verificar com teste E2E que a home carrega sem erro de console
- [ ] 1.6 Configurar `bun test` e Playwright no CI, verificando que a execução completa passa em branch limpa

## 2. Portfólio e persistência

- [ ] 2.1 Implementar os endpoints de projeto (listar, criar, abrir, alterar, duplicar, arquivar, excluir) e verificar com testes de contrato que cada operação persiste e é recuperável
- [ ] 2.2 Implementar a tela de portfólio (cards com resumo, busca, ordenação, estado vazio) e verificar com teste E2E que criar e abrir um projeto funciona de ponta a ponta
- [ ] 2.3 Implementar o sync em lote idempotente (debounce 800 ms, upsert/delete por chave) e verificar com teste que o reenvio do mesmo lote não duplica registros
- [ ] 2.4 Implementar snapshots periódicos (últimos 5) e recuperação na abertura, verificando com teste que um snapshot é oferecido quando o estado atual falha ao abrir
- [ ] 2.5 Implementar o registro de histórico de alterações (`change_log`) junto ao sync e verificar com teste que campos alterados, valores anterior/novo e data são gravados

## 3. Estado, comandos e hierarquia

- [ ] 3.1 Implementar `domainStore`, `computedStore` e `uiStore` separados, verificando com teste que editar domínio não altera `uiStore` nem gera persistência de UI
- [ ] 3.2 Implementar undo/redo com patches inversos (mínimo 100 passos, um por comando) e verificar com teste que indentar 5 tarefas desfaz em um único passo
- [ ] 3.3 Implementar a camada de comandos e o keymap com escopo (`grid`/`gantt`/`global`) e guarda de modo de edição, verificando com teste que cada atalho dispara o mesmo comando do menu e que nenhum atalho roda durante edição de célula
- [ ] 3.4 Implementar em `core/wbs` as operações de árvore (indent, outdent, move, insert, delete, renumber) com invariantes, verificando com testes os casos de bloqueio (sem irmão anterior, raiz) e a ordem relativa em seleção múltipla
- [ ] 3.5 Gerar o overlay de atalhos (`?`) a partir do keymap e verificar que o documento exibido corresponde aos bindings registrados

## 4. Task Sheet

- [ ] 4.1 Implementar a grade virtual com colunas fixas, cabeçalho sticky e scroll sincronizado, verificando com teste que a lista de linhas é idêntica à de `visibleRows`
- [ ] 4.2 Implementar os editors de célula por tipo (texto, data, duração, percentual, moeda, flag, lista, fórmula) com validação inline, verificando com testes o commit, o cancelamento por `Esc` e a recusa de valor inválido mantendo a célula aberta
- [ ] 4.3 Implementar navegação, seleção estendida e clipboard TSV com colar em lote, verificando com teste que colar 10 linhas cria 10 tarefas e um único `Ctrl+Z` as remove
- [ ] 4.4 Ligar indent/outdent/expand/collapse aos atalhos da grade, verificando com teste E2E os cenários 11–15 do PRD §8.1
- [ ] 4.5 Implementar o formulário de detalhes sob demanda (`F4`, `Detalhes`, duplo-clique na barra) com foco devolvido à célula ao fechar, verificando com teste E2E o cenário 19 do PRD §8.1
- [ ] 4.6 Implementar colunas configuráveis (largura, ordem, visibilidade) persistidas na visão e verificar com teste que a configuração sobrevive à troca de visão

## 5. Gantt

- [ ] 5.1 Implementar `timeScale` (pxPerDay contínuo, ticks em unidades de calendário inteiras, snap, limites 1,5–4.000) e verificar com testes a alinhamento das divisões em todos os níveis de zoom
- [ ] 5.2 Implementar `geometry` (retângulos das barras por tipo e paths ortogonais dos vínculos com lag/lead) e verificar com testes os quatro tipos de vínculo e a colisão de caminho
- [ ] 5.3 Implementar as camadas do Gantt (grid, tempo não útil, barras, progresso, links, marcadores, overlay) com virtualização em duas dimensões e verificar com teste que apenas linhas e datas visíveis são renderizadas
- [ ] 5.4 Implementar mover, redimensionar, criar vínculo, seleção e menu de contexto no Gantt, verificando com teste E2E a recusa de vínculo inválido e a escolha oferecida ao arrastar tarefa automática
- [ ] 5.5 Implementar zoom contínuo (atalhos, `Ctrl`+scroll centrado no ponteiro, slider, presets, `Ctrl+0`/`Ctrl+1`) e verificar com teste que a data sob o ponteiro permanece fixa durante o zoom
- [ ] 5.6 Implementar o escopo de foco `F6` com seleção e rolagem compartilhadas, verificando com teste E2E que `+` recolhe a hierarquia na grade e amplia o zoom no Gantt
- [ ] 5.7 Gerar a suíte visual Playwright (6 presets de zoom × 2 temas × 2 densidades) e verificar que as capturas são estáveis e sem regressão

## 6. Calendários e agendamento

- [ ] 6.1 Implementar em `core/calendar` as operações de tempo útil (adicionar/subtrair duração, converter datas, períodos) e verificar com testes de propriedade em turnos, exceções e fins de semana
- [ ] 6.2 Implementar a interface de calendários (dias úteis, turnos, exceções) e verificar com teste E2E que adicionar um feriado reagenda as tarefas afetadas e sombreia a coluna no Gantt
- [ ] 6.3 Implementar o pipeline de agendamento (expansão de recorrência, filtragem de inativas, grafo, roll-up, passagem direta e inversa, float e crítica) e verificar com testes unitários de cadeias simples e múltiplos caminhos críticos
- [ ] 6.4 Implementar restrições, prazos, tipos de tarefa e agendamento por esforço, verificando com testes os oito tipos de restrição, o conflito registrado e a relação duração × unidades × trabalho
- [ ] 6.5 Implementar tarefas inativas, de espaço reservado, roll-up top-down, splits e recorrência, verificando com testes que inativas não afetam roll-up, crítica nem superalocação
- [ ] 6.6 Executar o agendamento em Web Worker com recálculo incremental e verificar com medição que o recálculo completo de 5.000 tarefas fica em até 300 ms
- [ ] 6.7 Criar os cenários de paridade com o MS Project 2010 (PRD §8, itens 1–10) como fixtures automatizadas e verificar que a suíte passa em CI
- [ ] 6.8 Implementar o Task Inspector com cadeia condutora, motivos de agendamento e painel de conflitos, verificando com teste E2E a explicação correta de uma tarefa com três predecessores (um sem folga)

## 7. Dependências e recursos

- [ ] 7.1 Implementar a criação/remoção de vínculos com validação (ciclo, duplicidade, tarefa inexistente) e verificar com testes os quatro tipos e as recusas
- [ ] 7.2 Implementar a criação de vínculos pela coluna de predecessores, pelo formulário e pelo Gantt, verificando com teste E2E que os três caminhos produzem o mesmo registro e atualizam a grade
- [ ] 7.3 Implementar cadastro de pessoas e equipes e verificar com teste E2E a criação e a disponibilidade para atribuição
- [ ] 7.4 Implementar atribuições com cálculo de trabalho e custo e remover atribuição sem apagar a tarefa, verificando com testes os cálculos por unidade e por taxa
- [ ] 7.5 Implementar o painel de equipe com detecção de superalocação e reatribuição por arraste, verificando com teste E2E a marcação do período conflitante com a razão demanda/capacidade

## 8. Tracking

- [ ] 8.1 Implementar baselines múltiplas (até 11) e planos provisórios com escopo, verificando com testes o salvamento por seleção e a remoção
- [ ] 8.2 Implementar data de status e atualização em lote de tarefas/projeto, verificando com teste que tarefas antes da data de status são classificadas como atrasadas com o desvio correto
- [ ] 8.3 Implementar o Tracking Gantt com barra fantasma e colunas de desvio, verificando com teste E2E a comparação visual após salvar baseline
- [ ] 8.4 Implementar a linha de progresso e o preenchimento das barras, verificando com teste E2E os desvios à direita e à esquerda na data de status
- [ ] 8.5 Implementar o painel de alertas com navegação até a tarefa, verificando com teste E2E que o clique seleciona e rola até a tarefa correspondente

## 9. Personalização

- [ ] 9.1 Implementar campos personalizados (texto, número, data, duração, custo, flag, lista) e o interpretador de fórmulas sem `eval`, verificando com testes a avaliação correta e a recusa de expressão inválida
- [ ] 9.2 Implementar indicadores gráficos e códigos de estrutura com máscara, verificando com testes a prioridade de regra e a detecção de duplicidade
- [ ] 9.3 Implementar filtros, ordenação múltipla e agrupamento com sumário, verificando com testes os combinadores E/OU e o estado vazio
- [ ] 9.4 Implementar visões nomeadas e a biblioteca global, verificando com teste E2E que trocar de visão restaura colunas, filtros, layout e zoom

## 10. Saída: Timeline, impressão e import/export

- [ ] 10.1 Implementar a Timeline (adição por arraste, recorte do intervalo, personalização, PNG) e verificar com teste E2E que o recorte sincroniza o Gantt
- [ ] 10.2 Implementar o modo de impressão (cabeçalho, rodapé, escala, colunas, legenda, orientação) e verificar com captura de página que o PDF gerado não corta barras nem repete cabeçalho indevidamente
- [ ] 10.3 Implementar a importação JSON/CSV (detecção, mapeamento, pré-validação, commit transacional) e verificar com testes o round-trip, o relatório de erros e a recusa de arquivo acima do limite
- [ ] 10.4 Implementar a exportação JSON e CSV do escopo visível com proteção de injeção e verificar com teste que exportar e importar reproduz o mesmo projeto

## 11. Verificação de integração

- [ ] 11.1 Executar o E2E completo (criar projeto → estruturar WBS por teclado → vincular → atribuir recursos → salvar baseline → atualizar progresso → imprimir PDF) e verificar que passa de ponta a ponta
- [ ] 11.2 Verificar a cobertura de `packages/core` ≥ 90% e registrar o resultado do relatório
- [ ] 11.3 Verificar a acessibilidade (operação só por teclado, papéis ARIA da grade, contraste, `prefers-reduced-motion`) com teste automatizado e revisão manual registrada
- [ ] 11.4 Verificar os orçamentos de performance (60 fps com 2.000 linhas, CPM ≤ 300 ms, abertura ≤ 1,5 s, tecla → render ≤ 16 ms) com medição automatizada
- [ ] 11.5 Publicar a documentação de atalhos, templates de importação e guia de uso, verificando que os comandos documentados executam como escritos

## Workflow follow-up

- Arquivar a change após a revisão do projeto e a verificação dos itens do grupo 11.
- Verificar o resultado arquivado (`openspec validate` e inventário de specs em `openspec/specs/`).

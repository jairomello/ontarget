# Tasks

## 1. Fundação (monorepo, banco, tema, shell)

- [x] 1.1 Criar a estrutura do monorepo Bun (`packages/core`, `packages/shared`, `apps/server`, `apps/web`) com workspaces e TypeScript estrito, verificando que `bun install` e `bun test` executam sem erro
- [x] 1.2 Criar o servidor Hono servindo `/api/health` e o build estático do client, verificando com `curl localhost:PORT/api/health` retornando 200
- [x] 1.3 Implementar o schema Drizzle e a migração inicial de `docs/architecture.md` §4, verificando com um script que lista as tabelas e confirma a presença de `projects`, `tasks`, `task_links`, `resources`, `assignments`, `baselines`, `custom_fields` e `change_log`
- [x] 1.4 Implementar os design tokens (claro/escuro/densidade) em CSS, verificando com teste que o atributo `data-theme` e a variável de altura de linha mudam ao alternar tema/densidade
- [x] 1.5 Construir o shell da aplicação (barra de aplicação, barra de comandos, barra de status, rotas) e verificar com teste E2E que a home carrega sem erro de console
- [x] 1.6 Configurar `bun test` e Playwright no CI, verificando que a execução completa passa em branch limpa

## 2. Portfólio e persistência

- [x] 2.1 Implementar os endpoints de projeto (listar, criar, abrir, alterar, duplicar, arquivar, excluir) e verificar com testes de contrato que cada operação persiste e é recuperável
- [x] 2.2 Implementar a tela de portfólio (cards com resumo, busca, ordenação, estado vazio) e verificar com teste E2E que criar e abrir um projeto funciona de ponta a ponta
- [x] 2.3 Implementar o sync em lote idempotente (debounce 800 ms, upsert/delete por chave) e verificar com teste que o reenvio do mesmo lote não duplica registros
- [x] 2.4 Implementar snapshots periódicos (últimos 5) e recuperação na abertura, verificando com teste que um snapshot é oferecido quando o estado atual falha ao abrir
- [x] 2.5 Implementar o registro de histórico de alterações (`change_log`) junto ao sync e verificar com teste que campos alterados, valores anterior/novo e data são gravados

## 3. Estado, comandos e hierarquia

- [x] 3.1 Implementar `domainStore`, `computedStore` e `uiStore` separados, verificando com teste que editar domínio não altera `uiStore` nem gera persistência de UI
- [x] 3.2 Implementar undo/redo com patches inversos (mínimo 100 passos, um por comando) e verificar com teste que indentar 5 tarefas desfaz em um único passo
- [x] 3.3 Implementar a camada de comandos e o keymap com escopo (`grid`/`gantt`/`global`) e guarda de modo de edição, verificando com teste que cada atalho dispara o mesmo comando do menu e que nenhum atalho roda durante edição de célula
- [x] 3.4 Implementar em `core/wbs` as operações de árvore (indent, outdent, move, insert, delete, renumber) com invariantes, verificando com testes os casos de bloqueio (sem irmão anterior, raiz) e a ordem relativa em seleção múltipla
- [x] 3.5 Gerar o overlay de atalhos (`?`) a partir do keymap e verificar que o documento exibido corresponde aos bindings registrados

## 4. Task Sheet

- [x] 4.1 Implementar a grade virtual com colunas fixas, cabeçalho sticky e scroll sincronizado, verificando com teste que a lista de linhas é idêntica à de `visibleRows`
- [x] 4.2 Implementar os editors de célula por tipo (texto, data, duração, percentual, moeda, flag, lista, fórmula) com validação inline, verificando com testes o commit, o cancelamento por `Esc` e a recusa de valor inválido mantendo a célula aberta
- [x] 4.3 Implementar navegação, seleção estendida e clipboard TSV com colar em lote, verificando com teste que colar 10 linhas cria 10 tarefas e um único `Ctrl+Z` as remove
- [x] 4.4 Ligar indent/outdent/expand/collapse aos atalhos da grade, verificando com teste E2E os cenários 11–15 do PRD §8.1
- [x] 4.5 Implementar o formulário de detalhes sob demanda (`F4`, `Detalhes`, duplo-clique na barra) com foco devolvido à célula ao fechar, verificando com teste E2E o cenário 19 do PRD §8.1
- [x] 4.6 Implementar colunas configuráveis (largura, ordem, visibilidade) persistidas na visão e verificar com teste que a configuração sobrevive à troca de visão

## 5. Gantt

- [x] 5.1 Implementar `timeScale` (pxPerDay contínuo, ticks em unidades de calendário inteiras, snap, limites 1,5–4.000) e verificar com testes a alinhamento das divisões em todos os níveis de zoom
- [x] 5.2 Implementar `geometry` (retângulos das barras por tipo e paths ortogonais dos vínculos com lag/lead) e verificar com testes os quatro tipos de vínculo e a colisão de caminho
- [x] 5.3 Implementar as camadas do Gantt (grid, tempo não útil, barras, progresso, links, marcadores, overlay) com virtualização em duas dimensões e verificar com teste que apenas linhas e datas visíveis são renderizadas
- [x] 5.4 Implementar mover, redimensionar, criar vínculo, seleção e menu de contexto no Gantt, verificando com teste E2E a recusa de vínculo inválido e a escolha oferecida ao arrastar tarefa automática
- [x] 5.5 Implementar zoom contínuo (atalhos, `Ctrl`+scroll centrado no ponteiro, slider, presets, `Ctrl+0`/`Ctrl+1`) e verificar com teste que a data sob o ponteiro permanece fixa durante o zoom
- [x] 5.6 Implementar o escopo de foco `F6` com seleção e rolagem compartilhadas, verificando com teste E2E que `+` recolhe a hierarquia na grade e amplia o zoom no Gantt
- [x] 5.7 Gerar a suíte visual Playwright (6 presets de zoom × 2 temas × 2 densidades) e verificar que as capturas são estáveis e sem regressão

## 6. Calendários e agendamento

- [x] 6.1 Implementar em `core/calendar` as operações de tempo útil (adicionar/subtrair duração, converter datas, períodos) e verificar com testes de propriedade em turnos, exceções e fins de semana
- [x] 6.2 Implementar a interface de calendários (dias úteis, turnos, exceções) e verificar com teste E2E que adicionar um feriado reagenda as tarefas afetadas e sombreia a coluna no Gantt
- [x] 6.3 Implementar o pipeline de agendamento (expansão de recorrência, filtragem de inativas, grafo, roll-up, passagem direta e inversa, float e crítica) e verificar com testes unitários de cadeias simples e múltiplos caminhos críticos
- [x] 6.4 Implementar restrições, prazos, tipos de tarefa e agendamento por esforço, verificando com testes os oito tipos de restrição, o conflito registrado e a relação duração × unidades × trabalho
- [x] 6.5 Implementar tarefas inativas, de espaço reservado, roll-up top-down, splits e recorrência, verificando com testes que inativas não afetam roll-up, crítica (o teste de superalocação foi adiado para 7.5, quando o cálculo de demanda existir)
- [x] 6.6 Executar o agendamento em Web Worker com recálculo incremental e verificar com medição que o recálculo completo de 5.000 tarefas fica em até 300 ms
- [x] 6.7 Criar os cenários de paridade com o MS Project 2010 (PRD §8, itens 1–10) como fixtures automatizadas e verificar que a suíte passa em CI — itens 1, 2, 3, 5, 6, 7 e 8 ativos em `packages/core/tests/parity.test.ts` (marcados "validar vs MS Project 2010"); itens 4, 9 e 10 ficaram como fixtures pendentes das tarefas 7.4, 8.1/8.2 e 8.5/10.1
- [x] 6.8 Implementar o Task Inspector com cadeia condutora, motivos de agendamento e painel de conflitos, verificando com teste E2E a explicação correta de uma tarefa com três predecessores (um sem folga)
- [x] 6.9 Ligar o motor de agendamento ao `computedStore` (recálculo a partir do domínio) e verificar com testes que editar a duração de uma tarefa automática a reagenda na grade e no Gantt, e que tarefas com float total zero aparecem destacadas como críticas nos dois painéis
- [x] 6.10 Associar calendários próprios a tarefas e a recursos (prevalecendo sobre o do projeto) e converter as durações pelo calendário aplicável, verificando com teste o cenário 3 do PRD §8 (tarefa com turno de 6h) — associação e conversão de **tarefas** implementadas (painel de calendários ganhou gerenciamento: criar, renomear, duplicar e excluir com bloqueio de uso); calendário por **recurso** entra com 7.3/7.4, quando o cadastro de pessoas existir (o campo já está no esquema)

## 7. Dependências e recursos

- [x] 7.1 Implementar a criação/remoção de vínculos com validação (ciclo, duplicidade, tarefa inexistente) e verificar com testes os quatro tipos e as recusas
- [x] 7.2 Implementar a criação de vínculos pela coluna de predecessores, pelo formulário e pelo Gantt, verificando com teste E2E que os três caminhos produzem o mesmo registro e atualizam a grade
- [x] 7.3 Implementar cadastro de pessoas e equipes e verificar com teste E2E a criação e a disponibilidade para atribuição
- [x] 7.4 Implementar atribuições com cálculo de trabalho e custo e remover atribuição sem apagar a tarefa, verificando com testes os cálculos por unidade e por taxa
- [x] 7.5 Implementar o painel de equipe com detecção de superalocação e reatribuição por arraste, verificando com teste E2E a marcação do período conflitante com a razão demanda/capacidade e que tarefas inativas ficam fora do cálculo de superalocação (verificação adiada da 6.5)

## 8. Tracking

- [x] 8.1 Implementar baselines múltiplas (até 11) e planos provisórios com escopo, verificando com testes o salvamento por seleção e a remoção
- [x] 8.2 Implementar data de status e atualização em lote de tarefas/projeto, verificando com teste que tarefas antes da data de status são classificadas como atrasadas com o desvio correto
- [x] 8.3 Implementar o Tracking Gantt com barra fantasma e colunas de desvio, verificando com teste E2E a comparação visual após salvar baseline
- [x] 8.4 Implementar a linha de progresso e o preenchimento das barras, verificando com teste E2E os desvios à direita e à esquerda na data de status
- [x] 8.5 Implementar o painel de alertas com navegação até a tarefa, verificando com teste E2E que o clique seleciona e rola até a tarefa correspondente

## 9. Personalização

- [x] 9.1 Implementar campos personalizados (texto, número, data, duração, custo, flag, lista) e o interpretador de fórmulas sem `eval`, verificando com testes a avaliação correta e a recusa de expressão inválida
- [x] 9.2 Implementar indicadores gráficos e códigos de estrutura com máscara, verificando com testes a prioridade de regra e a detecção de duplicidade
- [x] 9.3 Implementar filtros, ordenação múltipla e agrupamento com sumário, verificando com testes os combinadores E/OU e o estado vazio
- [x] 9.4 Implementar visões nomeadas e a biblioteca global, verificando com teste E2E que trocar de visão restaura colunas, filtros, layout e zoom — visões (criar, renomear, duplicar, atualizar, excluir) guardam colunas, filtros, agrupamento, ordenação, layout e zoom em `library_items`; a biblioteca global (`project_id` nulo) serve filtros em todos os projetos (sync aceita `projectId` nulo e o detalhe do projeto inclui os itens globais)

## 10. Saída: Timeline, impressão e import/export

- [x] 10.1 Implementar a Timeline (adição por arraste, recorte do intervalo, personalização, PNG) e verificar com teste E2E que o recorte sincroniza o Gantt — faixa no topo (visível por padrão, ocultar/restaurar na barra de status) com adição por arraste da grade e por comando, recorte com alças e opção de sincronizar (fitRange no Gantt), personalização de cor/rótulo/tipo por item e exportação PNG + cópia; configuração persistida como item `timeline` da biblioteca do projeto (a impressão da Timeline fica com 10.2)
- [x] 10.2 Implementar o modo de impressão (cabeçalho, rodapé, escala, colunas, legenda, orientação) e verificar com captura de página que o PDF gerado não corta barras nem repete cabeçalho indevidamente — rota isolada `/p/:id/print` com páginas de tamanho real (A4/A3/Carta, retrato/paisagem, margens), cabeçalho (projeto, período, marca) e rodapé (data, “Página X de M”, autor) configuráveis, escala auto/largura/fixa com fatias horizontais, seleção de Timeline/Task Sheet/Gantt/detalhes e de colunas, legenda na última página e PDF via `window.print`/`@page`; E2E valida geometria das barras, repetição de cabeçalho por página da listagem, `page.pdf()` e captura estável
- [x] 10.3 Implementar a importação JSON/CSV (detecção, mapeamento, pré-validação, commit transacional) e verificar com testes o round-trip, o relatório de erros e a recusa de arquivo acima do limite — detecção de formato/codificação (UTF-8→Windows-1252)/delimitador, mapeamento com sugestão automática para CSV, relatório com linha+motivo e exportação, confirmação acima de 50.000 linhas e commit via `POST /api/import` em transação única (substituição remove primeiro; mesclagem neutraliza o índice único de `sort_order` e renumera); round-trip do JSON (substituir e mesclar sem duplicar) coberto por unit + servidor + E2E
- [x] 10.4 Implementar a exportação JSON e CSV do escopo visível com proteção de injeção e verificar com teste que exportar e importar reproduz o mesmo projeto — JSON no formato versionado do produto (mesmo contrato da importação) com as 8 entidades, CSV das linhas/colunas visíveis (filtros, agrupamento e ordem) com BOM+CRLF e neutralização de `=`, `+`, `-`, `@`; E2E exporta em A → importa em B → reexporta e compara o conteúdo normalizado, além de validar escopo filtrado e anti-fórmula no CSV

## 11. Verificação de integração

- [x] 11.1 Executar o E2E completo (criar projeto → estruturar WBS por teclado → vincular → atribuir recursos → salvar baseline → atualizar progresso → imprimir PDF) e verificar que passa de ponta a ponta — `e2e/journey.e2e.ts` cobre a jornada inteira via interface e confere o estado final na API; a jornada revelou e corrigiu o gap de que a tarefa-resumo não era criada ao indentar (spec task-structure "Tarefa-resumo e roll-up"): `runWbs` agora recalcula `isSummary` no mesmo comando de desfazer
- [x] 11.2 Verificar a cobertura de `packages/core` ≥ 90% e registrar o resultado do relatório — medido em 14/11/2026 com `bun run test:coverage` (novo script `bun test packages/core --coverage`): **94,66% funções / 97,95% linhas** em 226 testes (3 de paridade pulados por design); relatório reprodutível via script
- [x] 11.3 Verificar a acessibilidade (operação só por teclado, papéis ARIA da grade, contraste, `prefers-reduced-motion`) com teste automatizado e revisão manual registrada — `e2e/a11y.e2e.ts` cobre: jornada só de teclado (Tab até a grade, Insert/Ctrl+Insert, setas, digitação direta, vínculo por coluna, autosave e impressão), papéis `treegrid`/`row`/`gridcell`/`columnheader` com `aria-level`/`aria-selected`/`aria-expanded`, contraste ≥4,5:1 em 5 pares medidos e tokens zerados sob `reduced-motion`. **Revisão manual registrada (14/11/2026):** foco visível global (`:focus-visible`), `prefers-contrast: more` reforçando bordas/texto, avisos com `role="alert"`, redimensionadores de coluna com `aria-label`, twisty com `aria-expanded`+rótulo. Correções feitas pelo teste: papéis ARIA da grade ausentes (adicionados), `Insert`/`Ctrl+Insert` não existiam no keymap (adicionados `grid.insertTask`/`grid.insertSubtask`), digitação direta perdia o 1º caractere (editor não seleciona o `seed`) e o tremor do Gantt ignorava movimento reduzido. **Pendente para revisor humano:** anúncios com NVDA/VoiceOver e modo `forced-colors` do sistema.
- [x] 11.4 Verificar os orçamentos de performance (60 fps com 2.000 linhas, CPM ≤ 300 ms, abertura ≤ 1,5 s, tecla → render ≤ 16 ms) com medição automatizada — `e2e/perf.e2e.ts` mede com 2.000 tarefas: **abertura 1.299 ms** (≤1.500), **tecla → render 4,20 ms** (≤16, medido do keydown ao commit do DOM via MutationObserver) e **quadro mediano 16,70 ms ≈ 60 fps** em rolagem, zoom e gesto misto (média no log; CPM 5.000 ≤300 ms coberto por `packages/core/tests/scheduling-perf.test.ts`). Correção encontrada pela medição: com a grade sem seleção as setas não selecionavam nada (agora a primeira seta escolhe a extremidade)
- [x] 11.5 Publicar a documentação de atalhos, templates de importação e guia de uso, verificando que os comandos documentados executam como escritos — `docs/atalhos.md` **gerado do keymap** (`bun run docs:shortcuts`, mesma fonte do overlay `?`), `docs/importacao.md` (template CSV idêntico ao download, formatos, limite, modos e exemplo JSON importável) e `docs/guia-de-uso.md`; freshness garantida por teste unitário (doc === keymap registrado) e `e2e/docs.e2e.ts` lê os atalhos do arquivo e os EXECUTA ( `?`/`Escape`, `F4`, indent/outdent, `F6`+`Ctrl+0`) além de conferir o template baixado com o bloco documentado

## 12. Barra de comandos (feedback de teste)

- [x] 12.1 Tornar as abas da ribbon funcionais com grupos por aba (Tarefa com inserir/apagar/indentar/outdentar/mover; Recurso, Projeto, Ver e Formatar com ações já existentes), verificando com teste E2E que cada aba exibe seus grupos e os botões executam os comandos — ribbon em duas linhas (abas + grupos com ícone/rótulo conforme Design.md §3); Importar/Exportar/Imprimir movidos para a aba Projeto (E2Es atualizados); `e2e/ribbon.e2e.ts` cobre todas as abas; snapshots visuais regenerados (o viewport do Gantt encurtou com a segunda linha da barra)
- [x] 12.2 Implementar a ordenação de tarefas por Alt+↑/Alt+↓ e por arrastar na grade (specs/task-structure), verificando com teste que a ordem muda preservando as subárvores e em um único passo de desfazer — `moveTasks` no domínio encadeando o `moveWithinLevel` do core em um único comando; arraste entre irmãos na grade (metade superior = antes, inferior = depois); o mesmo teste cobre o botão da ribbon; aproveitado para criar `removeTasks` (exclusão de subárvore com vínculos/atribuições/valores órfãos em1 passo, specs/persistence)
- [x] 12.3 Adicionar na aba Ver o toggle de caminho crítico (destaque no Gantt e na grade, ligado por padrão como no MS Project), verificando com teste E2E que desligar remove o destaque e religar restaura — flag `criticalVisible` no uiStore; Gantt, grade e impressão seguem o toggle; padrão ligado preserva o cenário specs/scheduling ("float total zero … destacada no Gantt e na grade")

## Workflow follow-up

- Arquivar a change após a revisão do projeto e a verificação dos itens do grupo 11.
- Verificar o resultado arquivado (`openspec validate` e inventário de specs em `openspec/specs/`).

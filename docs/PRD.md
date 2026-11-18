# PRD — ontarget

Produto de gerenciamento de projetos para a web, inspirado no **Microsoft Project 2010**, com visual renovado.

- Versão do documento: 0.1 (inicial)
- Data: 13 de novembro de 2026
- Status: Draft
- Documentos relacionados: `docs/Design.md`, `docs/architecture.md`

---

## 1. Visão geral

O **ontarget** é uma aplicação web executada localmente (runtime Bun + SQLite), com **contas locais** (primeiro acesso cria a conta; depois é só login por e-mail e senha), que reproduz a experiência de planejamento de projetos do MS Project 2010 — em especial o **Gantt Chart**, o **Task Sheet** e o agendamento controlado pelo usuário — mas com interface atual, sistema de design próprio e renderização de gráficos de alta qualidade.

O usuário mantém o domínio mental do MS Project (estrutura WBS, dependências, calendários, baselines, tracking), enquanto a aplicação elimina fricções antigas: nada de barras de ferramentas datadas, dialogs modais em excesso, ou exportações quebradas.

**Decisões de escopo confirmadas com o usuário:**

| Tema | Decisão |
| --- | --- |
| Autenticação | **Conta local**: o primeiro acesso cria a conta e a partir daí é login por e-mail e senha. Os projetos continuam compartilhados por instalação (sem dono por projeto). |
| Projetos | **Múltiplos projetos + portfólio** (tela inicial listando todos, com resumo e progresso). |
| Colaboração | Assíncrona via atribuição a recursos pré-cadastrados em equipes. **Sem** tempo real. |
| Stack | JavaScript/TypeScript + React + CSS + Bun + SQLite. |

---

## 2. Objetivos

### 2.1 Objetivos de produto

1. Reproduzir as funcionalidades essenciais do MS Project 2010 selecionadas pelo usuário (§5), com paridade de comportamento no agendamento e no tracking.
2. Entregar um **Gantt Chart de acabamento excepcional**: barras legíveis em qualquer escala, links com geometria precisa, zoom contínuo e suave, e feedback visual consistente.
3. Oferecer experiência moderna: tema claro/escuro, densidade ajustável, atalhos de teclado completos, undo/redo global, edição inline estilo Excel.
4. Manter o app leve e rápido: abertura de projeto com 5.000 tarefas em < 1,5 s, zoom sem jank.

### 2.2 Métricas de sucesso

| Métrica | Alvo |
| --- | --- |
| Latência de zoom/pan no Gantt | ≥ 60 fps com 2.000 tarefas visíveis |
| Tempo de abertura de projeto de 5.000 tarefas | < 1,5 s (p95) |
| Recálculo de agendamento (CPM) | < 300 ms em projetos de 5.000 tarefas |
| Fidelidade do agendamento vs. MS Project | 100% nos cenários de teste de referência |
| Cobertura de testes do motor de agendamento | > 90% (linhas) |
| Suporte de navegadores | Chrome/Edge/Firefox/Safari (últimas 2 versões) |

### 2.3 Objetivos de negócio / produto secundários

- Servir como base para evolução futura (multiusuário, real-time, Project Server-like) sem reescrita.
- Evitar dependência de bibliotecas de Gantt de terceiros de baixo acabamento: o Gantt é **próprio**.

---

## 3. Público-alvo

- **P1 — Gerente de projeto individual** que migrava de MS Project 2010 e precisa de paridade funcional com UI moderna.
- **P2 — Analista/planejador** que trabalha com WBS detalhado, recursos e tracking semanal.
- **P3 — Estudante/equipe pequena** que precisa de um Gantt bonito para apresentação e impressão/PDF.

---

## 4. Escopo

### 4.1 Dentro do escopo (v1)

- Portfólio de múltiplos projetos (criar, abrir, duplicar, arquivar, excluir).
- Task Sheet com estrutura de outline (WBS), edição inline e formulário de detalhes.
- Gantt Chart completo com zoom, escala, arrastar-e-soltar, dependências, baseline, tracking.
- Timeline (linha do tempo) no topo das visualizações.
- Agendamento manual/automático, calendários, restrições, prazos, tarefas inativas e de espaço reservado.
- Recursos (pessoas) pré-cadastrados em equipes + atribuição a tarefas.
- Baselines múltiplos, planos provisórios, % concluído, custos/trabalho reais.
- Campos personalizados, códigos de WBS, tabelas/visões/filtros/grupos personalizados.
- Importação JSON/CSV a partir de template + exportação JSON/CSV.
- Impressão/PDF com escalas de tempo, cabeçalho, rodapé e legenda.
- Undo/redo global, tema claro/escuro, densidade de linhas.

### 4.2 Fora do escopo (v1)

- Autenticação, multiusuário, permissões, tempo real.
- Project Server / PWA / timesheets / publicação.
- Sync com SharePoint, e-mail, Outlook.
- Recurso de custo/material (apenas recursos de trabalho/pessoa, com taxas e custo por atribuição).
- Nivelamento automático de recursos completo (fica para v2; v1 expõe superalocação e visualização).
- Análise de valor agregado completa (v1: campos e relatórios básicos de custo).
- Relatórios Visual Reports em Excel/Visio (v1: exportação de dados + relatório de progresso em PDF/HTML).
- Suporte a arquivos .mpp nativos (v1: JSON/CSV; .mpp apenas via importação por conversão externa, opcional).

---

## 5. Requisitos funcionais

Legenda de prioridade: **P0** = obrigatório no v1, **P1** = desejável, **P2** = futuro.
Códigos `2.x`, `5.x`, `6.x`, `7.x`, `9.x` referenciam a lista original do MS Project 2010 fornecida pelo usuário.

### 5.1 Agendamento e planejamento de tarefas (RF-2.x)

| ID | Prioridade | Requisito | Critério de aceite (resumo) |
| --- | --- | --- | --- |
| RF-02.1 | P0 | Agendamento controlado pelo usuário: manual vs. automático por tarefa e por projeto | Botão de conversão em lote (Task > Auto/Manual Schedule); tarefas manuais não são movidas por dependências, mas propagam suas datas aos sucessores; conversão automático→manual preserva datas. |
| RF-02.2 | P0 | Tarefas de espaço reservado (placeholder) | Permite criar tarefa só com nome e qualquer combinação de início/término/duração; campos ausentes ficam pendentes e o Gantt mostra a barra em estilo "indefinido". |
| RF-02.3 | P0 | Tarefas inativas | Tarefa inativa é mantida com dados (custos, alocações, campos), exibida com estilo tracejado, **excluída** de rollups, cálculo crítico e leveling; botão de reativar. |
| RF-02.4 | P0 | Resumo top-down | Criar tarefa-resumo antes das subtarefas; datas do resumo podem divergir do roll-up (datas manuais no resumo); ao vincular, comportamento explícito de "alinhamento". |
| RF-02.5 | P0 | EAP/WBS e códigos de WBS | Estrutura por indentar/outdentar; numeração automática `1.2.3.4` (outline number); coluna editável de WBS code com máscara personalizável. |
| RF-02.6 | P0 | Dependências FS, SS, FF, SF com lag/lead | Criação por arrastar entre barras e por campo; lag positivo e lead (negativo); inspeção do link (hover destaca a cadeia condutora); remoção; **vínculo entre projetos** (v1: link lido de campo de referência externo, sem recálculo entre arquivos — ver §5.9). |
| RF-02.6b | P1 | "Respect links" / repactuar | Ação que reordena/aplica dependências ignoradas por modo manual, com prévia do impacto. |
| RF-02.7 | P0 | Restrições de data e prazos (deadlines) | Tipos: ASAP, ALAP, Começar Não Antes De, Começar Não Depois De, Terminar Não Antes De, Terminar Não Depois De, Deve Começar/Terminar Em; ícone de restrição na coluna e no Gantt; deadline com marcador no timeline e alerta quando excedido. |
| RF-02.8 | P0 | Calendários de projeto, tarefa e recurso | Calendário padrão do projeto + calendários por tarefa e por recurso; dias úteis por padrão semanal (turnos início/término); exceções (feriados, finais de semana úteis); **tempo não útil** sombreado no Gantt. |
| RF-02.9 | P0 | Tipos de tarefa e agendamento condicionado pelo esforço | Fixed Duration, Fixed Work, Fixed Units; opção effort-driven; cálculo consistente de duração × unidades × trabalho. |
| RF-02.10 | P0 | Marcos, tarefas recorrentes, splits, resumo/subtarefas | Milestone (duração 0, losango); recorrência diária/semanal/mensal com fim por data ou ocorrências; divisão de tarefa em segmentos com intervalo; indentação/outdentação com atalhos. |
| RF-02.11 | P0 | Estimativas de duração e unidades | Duração em unidades de tempo configuráveis (horas, dias, semanas, meses) com arredondamento pelo calendário; flag de duração estimada (campo "Duration Estimated"). |
| RF-02.12 | P0 | Múltiplos caminhos críticos e formatação de tarefas críticas | CPM forward/backward com float total; destaque automático do caminho crítico (cor + estilo); suporte a múltiplos caminhos terminando em marcos/restrições; botão de "Exibir caminho crítico". |
| RF-02.13a | P0 | Classificação, filtros, agrupamentos e realce de alterações | Sort (múltiplos campos, asc/desc), filtros (salvos, combinados por AND/OR), agrupamentos (nível + cabeçalho com sumário), e **change highlighting** (realçar campos alterados desde uma data/marco de referência). |
| RF-02.13b | P0 | Atribuição de tarefas a recursos (pessoas pré-cadastradas em equipes) | Tela de recursos (pessoas) por equipe; atribuir por campo ou arrastando no Team-Panel; unidades %, trabalho e custo calculados; indicador de superalocação. |

### 5.2 Acompanhamento e controle (RF-5.x)

| ID | Prioridade | Requisito | Critério de aceite (resumo) |
| --- | --- | --- | --- |
| RF-05.1 | P0 | Baselines múltiplos e planos provisórios | Até 11 baselines nomeáveis + planos provisórios; salvar baseline por escopo (projeto/tarefas selecionadas); exibição como barra fantasma no Gantt e colunas de desvio. |
| RF-05.2 | P0 | Data de status e atualização | Definir *status date*; ações "Atualizar tarefas" (% concluído, trabalho real) e "Atualizar projeto" (propagar para os sucessores); atualização automática da data de status com base no relógio. |
| RF-05.3 | P0 | % concluído, custos reais, durações reais, trabalho real | Campos de tracking preenchíveis e recalculados; barra de progresso dentro da barra do Gantt; colunas de baseline/real/desvio. |
| RF-05.4 | P0 | Tracking Gantt, barras de progresso e linhas de progresso | Visão Tracking Gantt (baseline + atual); progresso preenchido na barra; **linha de progresso** (progress line) com desvios à frente/atrás de hoje. |
| RF-05.6 | P0 | Replanejamento: Move task, tarefas inativas, simulação what-if | Mover tarefa com efeito nos dependentes; criar cópia do projeto ("Save as scenario") para simular; tarefas inativas para cenários. |
| RF-05.7 | P0 | Alertas de tarefas fora do prazo, tarefas condutoras, inspeção de vínculos | Painel de alertas (fora de prazo, superalocação, restrição conflitante, link inválido); destaque da cadeia condutora (predecessor chain) ao selecionar tarefa; Task Inspector com motivos do agendamento. |

### 5.3 Visualizações (RF-6.x)

| ID | Prioridade | Requisito | Critério de aceite (resumo) |
| --- | --- | --- | --- |
| RF-06.1 | P0 | Timeline (linha do tempo) | Sempre visível no topo por padrão; adicionar/remover tarefas e marcos; arrastar para ajustar o intervalo exibido; personalização de cor/rótulo; impressão e cópia (PNG/clipboard). |
| RF-06.2 | P0 | Gantt Chart | Ver `docs/Design.md` §6 (especificação visual) e §7 (zoom/escala). |
| RF-06.5a | P0 | **Task Sheet (grade WBS) como área principal de edição** | Grade estilo Excel à esquerda do Gantt, sincronizada linha a linha: colunas configuráveis, colunas fixas (sticky header e coluna de nome), redimensionamento, reordenação e ordenação; seleção e rolagem sempre espelhadas no Gantt. |
| RF-06.5b | P0 | **Edição 100% inline** | Todo campo editável é alterado na própria célula (`F2` ou duplo-clique, ou digitação direta substitui o conteúdo). Nenhuma operação comum exige abrir diálogo ou formulário. `Tab`/`Shift+Tab` avançam/voltam na linha, `Enter` confirma e desce, `Esc` cancela, `Ctrl+Enter` confirma mantendo a célula. Edição por digitação em lote: colar várias linhas (`Ctrl+V`) distribui por células/linhas. |
| RF-06.5c | P0 | **Edição da hierarquia WBS por teclado** | `Ctrl+Shift+Right` = indentar (virar subtarefa do anterior); `Ctrl+Shift+Left` = outdentar (promover um nível); `Tab` na primeira coluna = indentar; `Shift+Tab` na primeira coluna = outdentar. Indentar/outdentar funciona em **seleção múltipla** (bloco inteiro) e desfazível com `Ctrl+Z`. Numeração WBS (`1.2.3`) e nível se recalculam imediatamente. |
| RF-06.5d | P0 | **Recolher e expandir a hierarquia** | Seta na coluna 1 e atalhos: `+` expandir (e `Ctrl++` expandir tudo sob a seleção), `-` recolher (e `Ctrl+-` recolher tudo sob a seleção), `Ctrl+Shift+*` expandir/recolher tudo; duplo-clique no nome alterna; `Alt+↑/↓` move a tarefa reordenando; expand/collapse é persistido por visão e não perde a seleção. |
| RF-06.5e | P0 | **Formulário de detalhes sob demanda** | O Task Form **não** abre automaticamente. Abre apenas quando o usuário pedir: `F4`, botão `Detalhes` na barra de status, duplo-clique na barra do Gantt, ou item de menu `Propriedades`. Fechar (`Esc`) retorna o foco à célula que estava ativa. |
| RF-06.5f | P0 | **Navegação por teclado na grade** | Setas movem a célula; `Page Up/Down` uma tela; `Ctrl+Home/Início` e `Ctrl+End/Fim` extremos; `Home/End` início/fim da linha; seleção por intervalo com `Shift+setas`/`Shift+Page`; `Ctrl+A` seleciona a coluna/todas as linhas visíveis; `Ctrl+F` busca com destaque. Nenhuma tecla de navegação é capturada enquanto uma célula estiver em modo de edição. |
| RF-06.5g | P1 | **Menus de contexto e toque** | Clique direito em célula/linha com ações de WBS (inserir antes/depois, indentar, outdentar, excluir, vincular, inativar), com atalhos exibidos ao lado de cada item. |
| RF-06.6 | P0 | Formulários de tarefa e de recurso | Painel de detalhes (Task Form / Resource Form) acessado **sob demanda** (ver RF-06.5e), com seções: Geral, Datas, Agendamento, Custos, Atribuições, Campos personalizados, Notas; edições refletem imediatamente na grade e no Gantt. |
| RF-06.7 | P0 | Visões divididas e painel de detalhes | Layout split: Timeline (topo) + Task Sheet/Gantt (meio) + Form (rodapé); alternar painéis sem perder estado de seleção; redimensionar divisores; salvar layout em **visão personalizada**. |

### 5.4 Relatórios e saída (RF-7.x)

| ID | Prioridade | Requisito | Critério de aceite (resumo) |
| --- | --- | --- | --- |
| RF-07.4 | P0 | Impressão/PDF | Modo de impressão dedicado (preview) com: cabeçalho/rodapé configuráveis, legenda, escala de tempo (auto/ajustar à página/largura da página), repetição de cabeçalho de colunas, seleção de colunas visíveis, marca d'água, orientação retrato/paisagem; exportação PDF via navegador e geração server-side opcional (headless Chromium). |
| RF-07.5 | P1 | Relatórios de dados | Exportação CSV/JSON do estado atual (com filtros/grupos aplicados) e relatório de progresso (resumo, % por fase, tarefas em atraso) em PDF/HTML. |

### 5.5 Personalização e automação (RF-9.x)

| ID | Prioridade | Requisito | Critério de aceite (resumo) |
| --- | --- | --- | --- |
| RF-09.1 | P0 | Campos personalizados | Tipos: Texto, Número, Data, Duração, Custo, Sinalizador (Flag), Fórmula, Lista de valores; indicadores gráficos (condições com ícone); aplicáveis a tarefa, recurso e projeto. |
| RF-09.2 | P0 | Códigos de estrutura (outline codes) e WBS | Máscara por nível (`A.00.00.00`, `1.1.1` etc.), geração automática e manual, coluna editável, validação de duplicidade. |
| RF-09.3 | P0 | Tabelas, visões, filtros, grupos e calendários personalizados | Criar/editar/duplicar/excluir; visões nomeadas salvas por projeto (ou na biblioteca global do app); aplicação rápida pela barra de status. |
| RF-09.4 | P0 | Importação a partir de JSON e CSV com template | Mapeamento de colunas (wizard), detecção automática de delimitador/encoding, template padrão publicado (baixável), pré-validação com relatório de erros, importação incremental (substituir/manter). |
| RF-09.5 | P1 | Exportação JSON/CSV | Exportar projeto completo (JSON) ou escopo filtrado (CSV); template de importação compatível com a exportação (round-trip). |

### 5.6 Requisitos de plataforma (RF-PLATAFORMA)

| ID | Prioridade | Requisito |
| --- | --- | --- |
| RF-P01 | P0 | Portfólio: listar projetos com nome, datas, % geral, nº de tarefas, atualização; abrir, duplicar, arquivar, excluir. |
| RF-P02 | P0 | Persistência local em SQLite via Bun; sem perda de dados entre sessões (autosave). |
| RF-P03 | P0 | Undo/redo global (≥ 100 passos) para edições de estrutura, datas, dependências e atribuições. |
| RF-P04 | P0 | Tema claro/escuro, densidade de linhas (compacta/confortável) e paleta de cor, aplicados na hora e persistidos **na conta** (valem em qualquer navegador). |
| RF-P05 | P1 | Biblioteca global (Global.MPT): visões, filtros, calendários, grupos e códigos reutilizáveis entre projetos. |
| RF-P06 | P0 | Atalhos de teclado completos, sem conflito com a digitação em células, e documentados em overlay (`?`). O app deve ser plenamente operável sem mouse. |

---

## 6. Requisitos não funcionais

| ID | Área | Requisito |
| --- | --- | --- |
| RNF-01 | Performance | Zoom/pan ≥ 60 fps com 2.000 linhas; renderização virtualizada (linhas e colunas). |
| RNF-02 | Performance | Recálculo incremental do agendamento: ao alterar uma tarefa, recalcular apenas a cadeia afetada (escopo subjacente). |
| RNF-03 | Confiabilidade | Autosave incremental (debounce 800 ms) + snapshot por sessão; recuperação após fechamento abrupto. |
| RNF-04 | Confiabilidade | Transações atômicas no SQLite (rollback em falha); integridade referencial garantida. |
| RNF-05 | Usabilidade | Nenhuma operação destrutiva sem undo disponível. |
| RNF-06 | Acessibilidade | Navegação completa por teclado na grade (roles ARIA de grid), foco visível, contraste AA, `prefers-reduced-motion`. |
| RNF-07 | Portabilidade | Windows, macOS e Linux; Chrome/Edge/Firefox/Safari. |
| RNF-08 | Internacionalização | Strings centralizadas; datas em pt-BR por padrão, configurável. |
| RNF-09 | Segurança | Sanitização de entrada; escaping em exportações; sem remote code execution em fórmulas (limitado a funções predefinidas, sem `eval`). |
| RNF-10 | Manutenibilidade | Motor de agendamento puro (sem I/O) e testável isoladamente; 100% TypeScript. |

---

## 7. Fluxos principais

1. **Criar projeto** → escolher template (Vazio, Modelo de entrega, Engenharia, Marketing) → definir nome, início, calendário → abrir Task Sheet vazio com Gantt.
2. **Estruturar WBS** → digitar nomes diretamente na grade (`Enter` para nova linha) → indentar/outdentar por `Ctrl+Shift+Right/Left` → recolher/expandir com `-`/`+` → marcar marcos → definir dependências arrastando no Gantt → abrir o formulário de detalhes só quando precisar de um campo avançado (`F4`).
3. **Planejar recursos** → cadastrar pessoas em equipes → atribuir a tarefas (campo ou Team-Panel) → resolver superalocação.
4. **Baseline e tracking** → salvar baseline → rodar o status → preencher % concluído → comparar Tracking Gantt e alertas.
5. **Compartilhar** → ajustar layout de impressão → gerar PDF/CSV/JSON → exportar.
6. **Importar** → baixar template → preencher → importar com mapeamento → validar → aplicar.

---

## 8. Cenários de teste de referência (paridade com MS Project 2010)

Estes cenários viram testes automatizados do motor de agendamento (`@core/scheduler`) e definem a paridade:

1. Cadeia FS com lag em dias úteis e fim de semana → datas iguais às do MS Project.
2. Tarefa com restrição "Start No Earlier Than" e dependência SS → comportamento idêntico.
3. Calendário de tarefa diferente do projeto (turno de 6h) → duração convertida corretamente.
4. Fixed Work com 2 recursos em 50% → duração = trabalho / soma das unidades.
5. Tarefa manual dentro de uma cadeia automática → datas preservadas e propagadas aos sucessores.
6. Roll-up de resumo com tarefa inativa → inativa ignorada.
7. Splits: tarefa dividida com intervalo de 3 dias → duração total e datas corretas.
8. Recorrência semanal em mês com feriado → ocorrência deslocada conforme calendário.
9. Baseline salva antes do tracking → desvios (SV/SLIP) corretos.
10. Deadline excedido → alerta e marcador no timeline.

### 8.1 Cenários de interface (Task Sheet e WBS)

11. `Ctrl+Shift+Right` em uma tarefa → vira subtarefa da anterior, WBS `2` → `2.1`, e `Ctrl+Z` desfaz.
12. Indentar um bloco de 5 tarefas selecionadas → todas movem juntas, ordem relativa preservada.
13. `Ctrl+Shift+Left` na primeira subtarefa → promove para o nível do pai; WBS do restante da árvore se renumera.
14. `-` em um resumo → recolhe filhos, mantém a seleção na linha do resumo; `+` reexpande no mesmo ponto de rolagem.
15. `Ctrl+-`/`Ctrl++` → recolhe/expande recursivamente a subárvore da seleção.
16. Digitação direta (`3d`, `10/12`, `50%`) em célula → valida e aplica sem sair da célula; valor inválido mantém a edição aberta com erro.
17. `Tab` percorre as células da linha e, no fim, cria/salta para a linha seguinte; `Shift+Tab` volta.
18. Colar 10 linhas do Excel em `Nome` → cria 10 tarefas na posição correta, com um undo só.
19. `F4` abre o Task Form para a tarefa selecionada; `Esc` fecha e devolve o foco à célula editada antes.
20. Nenhuma tecla de navegação é interceptada enquanto uma célula está em modo de edição (escrever `-` não recolhe a árvore).

---

## 9. Glossário

- **CPM** — Critical Path Method; cálculo forward/backward de datas e float.
- **Baseline** — linha de base salva, usada para medir desvio.
- **Float total** — atraso possível sem afetar o fim do projeto.
- **Effort-driven** — ao adicionar recurso, o trabalho permanece e a duração encurta.
- **WBS** — Work Breakdown Structure; numeração hierárquica `1.2.3`.
- **Placeholder task** — tarefa com dados incompletos (só nome ou algumas datas).
- **Status date** — data de corte para cálculo de progresso/atraso.
- **Driving task** — tarefa que determina a data de início/fim de outra (cadeia condutora).

---

## 10. Roadmap

| Fase | Escopo | Resultado |
| --- | --- | --- |
| **F0 — Fundação** | Monorepo, Hono + SQLite + Drizzle, React + Vite, tokens de design, shell da UI, portfólio | App rodando com CRUD de projetos |
| **F1 — Task Sheet** | Grade outline virtualizada, edição inline com atalhos, indent/outdent, expand/collapse, Task Form sob demanda, WBS, undo/redo | Planejamento textual completo, operável só por teclado |
| **F2 — Gantt core** | Time-scale, renderização virtualizada, barras, links, zoom, arrastar-e-soltar | Gantt interativo e bonito |
| **F3 — Agendamento** | Motor CPM, calendários, restrições, tipos de tarefa, inativos, placeholder, recorrência, splits | Paridade de agendamento |
| **F4 — Recursos** | Recursos/equipes, atribuições, Team-Panel, superalocação | Gestão de pessoas |
| **F5 — Tracking** | Baselines, status date, %/real, Tracking Gantt, progress line, alertas | Controle do projeto |
| **F6 — Personalização** | Campos custom, filtros/grupos/tabelas/visões, change highlighting | Personalização |
| **F7 — Saída** | Timeline view, impressão/PDF, import/export JSON/CSV | Entrega e compartilhamento |
| **F8 — Polimento** | Acessibilidade, performance, i18n, docs, testes de paridade | Release v1.0 |

---

## 11. Riscos e mitigação

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Divergência de agendamento vs. MS Project | Alto | Cenários de referência (§8) como testes automatizados; motor puro e versionado. |
| Gantt com muitas tarefas ficar lento | Alto | Virtualização em duas dimensões, camadas separadas, medição contínua de frame time. |
| Escopo de calendários/turnos complexo demais | Médio | Biblioteca de calendários dedicada com testes de propriedade (round-trip de datas). |
| Undo/redo cobrindo estado complexo | Médio | Comandos estruturados (patch + inverse) em vez de snapshots completos; limite de pilha. |
| Dependência entre projetos sem motor multi-arquivo | Baixo | Definido como fora de escopo no v1 com campo de referência explícito. |

---

## 12. Fora de escopo confirmado (v1)

Autenticação · multiusuário · tempo real · Project Server/PWA/timesheets · sync SharePoint · recursos material/custos complexos · nivelamento automático completo · EVM completo · Visual Reports Excel/Visio · leitura/escrita nativa de `.mpp`.

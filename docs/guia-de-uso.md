# Guia de uso do ontarget

Aplicação local de planejamento de projetos com experiência inspirada no
MS Project 2010 (Bun + SQLite + React). Documentos de referência:

- [atalhos.md](atalhos.md) — todos os atalhos de teclado (gerados do keymap)
- [importacao.md](importacao.md) — importação/exportação de dados
- `PRD.md`, `Design.md`, `architecture.md` — requisitos, design e arquitetura

## Acesso e conta

- **Primeiro acesso**: com o banco sem nenhuma conta, o app abre a tela
  **Criar a primeira conta** (e-mail, nome e senha — mínimo de 10 caracteres).
  Depois disso a tela é de **Entrar**.
- **Menu de perfil** (canto direito da barra): mostra foto (ou iniciais),
  nome e e-mail, e leva a **Conta e preferências** e **Chaves de API (MCP)**;
  `Esc` fecha e as setas percorrem as ações. O mesmo menu tem troca rápida de
  tema, densidade e paleta.
- **Conta** (`/conta`): troca a foto (com recorte antes do envio), o nome de
  exibição, a senha (a atual é exigida e as outras sessões são encerradas),
  a aparência e as chaves. E-mail é somente leitura.
- **Redefinir a senha sem e-mail**: pare o app e rode
  `bun run auth:reset` (lista as contas) e `bun run auth:reset <e-mail>` para
  gerar uma nova senha — o valor é impresso uma única vez.
- **Chaves de API (MCP)**: crie com um nome, copie o valor (`ont_…`) na hora —
  ele não é exibido de novo — e revogue quando não precisar mais.

## Portfólio

Na tela inicial você cria (Vazio, Entrega de software, Planejamento de obras,
Marketing ou importando um arquivo), abre, duplica, arquiva e exclui
projetos; busca e ordenação mostram nome, período, % de conclusão e contagem
de tarefas. A exclusão pede confirmação com contagem e pode ser desfeita por
um toast de 10 segundos.

## Estruturando o projeto (Task Sheet)

- **Nome**: selecione a célula e digite — a digitação direta substitui o
  conteúdo; `F2` ou duplo-clique edita sem substituir; `Enter` confirma e
  desce, `Esc` cancela.
- **Hierarquia**: `Ctrl+Shift+Right`/`Ctrl+Shift+Left` recuam/promovem nível
  (o resumo é criado automaticamente); `Insert` insere tarefa e
  `Ctrl+Insert` insere subtarefa — a lista completa está em
  [atalhos.md](atalhos.md).
- **Colunas**: redimensionar, reordenar e ocultar pelo menu **Colunas**; a
  configuração fica salva por visão.
- **Vínculos**: digite o WBS do predecessor na coluna **Predecessores**
  (ou arraste no Gantt / use o formulário com `F4`).
- Tudo é salvo automaticamente — o indicador **Salvo** fica na barra de
  status; `Ctrl+Z` desfazer e `Ctrl+Y` refazer cobrem qualquer edição.

## Gantt

- Zoom: `Ctrl`+scroll centrado no ponteiro, presets na barra de status,
  `Ctrl+0` ajusta ao projeto e `Ctrl+1` à seleção.
- **Caminho crítico**: o destaque (barras e linhas críticas) vem ligado por
  padrão; alterne na aba **Ver** da barra de comandos, como no MS Project.
- Barras: arraste para reagendar (tarefas automáticas perguntam antes),
  arraste as bordas para mudar duração; arraste do manipulador de uma barra
  até outra para criar vínculo.
- `F6` alterna o foco entre a Task Sheet e o Gantt — com foco no Gantt,
  `+`/`-` controlam o zoom; com foco na grade, recolhem a hierarquia.

## Recursos e equipes

Painel **Recursos**: cadastre equipes e pessoas (unidades, taxa, calendário).
Atribua pela coluna **Recursos** da grade, pelo formulário de detalhes ou
arrastando no painel **Equipe**, que também mostra superalocação e permite
reatribuir por arraste.

## Acompanhamento

- **Baselines**: painel **Baseline** salva até 11 linhas de base (ou planos
  provisórios, só datas) com escopo de projeto ou seleção.
- **Data de status**: painel **Data de status** define a referência de
  atraso/progresso e faz a atualização em lote.
- **Tracking Gantt**: visão **Controle** mostra barra fantasma, colunas de
  desvio, linha de progresso e alertas navegáveis.

## Personalização

- **Campos**: painel **Campos** cria campos personalizados (texto, número,
  data, duração, custo, sinalizador, fórmula, lista) e indicadores.
- **Filtros**: painel **Filtros** combina condições por E/OU, filtros prontos
  (em atraso, críticas…), ordenação múltipla e agrupamento com sumário —
  vale para a grade **e** o Gantt.
- **Visões**: painel **Visões** guarda colunas, filtros, layout e zoom por
  visão e mantém uma **biblioteca global** compartilhada entre projetos.

## Timeline

Faixa no topo com os itens do projeto: arraste tarefas da grade para a
Timeline ou use **Adicionar**; arraste as extremidades para recortar o
intervalo exibido no Gantt (com sincronização opcional); personalize cor,
rótulo e tipo por item; exporte em PNG ou copie para a área de transferência.

## Impressão

Botão **Imprimir** abre a pré-visualização com páginas de tamanho real:
papel (A4/A3/Carta), orientação, margens, escala (ajustar à página, largura
ou fixa), seleção de visões e colunas, cabeçalho/rodapé configuráveis e
legenda. **Imprimir / Gerar PDF** usa o diálogo do navegador.

## Dados

- **Exportar JSON**: projeto completo no formato do produto (round-trip com
  a importação).
- **Exportar CSV**: exatamente as linhas e colunas visíveis da visão ativa
  (filtros, agrupamento e ordenação valem), com proteção contra fórmulas.
- **Importar**: CSV ou JSON com detecção automática, mapeamento e relatório
  de erros — ver [importacao.md](importacao.md).

## Acessibilidade

- Operação completa por teclado (grade incluída); `?` abre a tabela de
  atalhos do escopo atual.
- Tema claro/escuro/automático, densidade de linhas e paleta de cor no menu de perfil (e na página de conta), salvos na conta.
- Contraste WCAG AA, foco visível, `prefers-reduced-motion` e
  `prefers-contrast` respeitados.

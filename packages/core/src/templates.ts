/**
 * Templates de projeto (specs/portfolio — "Criação de projeto").
 * Cada template descreve uma árvore de tarefas inicial; os níveis são
 * aplicados pela ordem das entradas (a pilha de pais é mantida pelo serviço).
 */

export interface TemplateTask {
  name: string;
  /** 0 = raiz; 1 = filho da última tarefa de nível anterior. */
  level: number;
  /** Duração em dias úteis; 0 = marco. */
  durationDays: number;
  milestone?: boolean;
}

export interface ProjectTemplate {
  key: string;
  name: string;
  description: string;
  tasks: TemplateTask[];
}
export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    key: "vazio",
    name: "Vazio",
    description: "Projeto sem tarefas; você constrói a WBS do zero.",
    tasks: [],
  },
  {
    key: "entrega-software",
    name: "Entrega de software",
    description: "Levantamento, desenvolvimento, testes e implantação.",
    tasks: [
      { name: "Levantamento de requisitos", level: 0, durationDays: 10 },
      { name: "Especificação técnica", level: 1, durationDays: 5 },
      { name: "Aprovação da especificação", level: 1, durationDays: 0, milestone: true },
      { name: "Desenvolvimento", level: 0, durationDays: 30 },
      { name: "Ambiente de preparação", level: 1, durationDays: 3 },
      { name: "Módulo principal", level: 1, durationDays: 20 },
      { name: "Integração", level: 1, durationDays: 8 },
      { name: "Testes e homologação", level: 0, durationDays: 12 },
      { name: "Plano de testes", level: 1, durationDays: 4 },
      { name: "Execução de testes", level: 1, durationDays: 8 },
      { name: "Implantação", level: 0, durationDays: 5 },
      { name: "Go-live", level: 1, durationDays: 0, milestone: true },
    ],
  },
  {
    key: "obras",
    name: "Planejamento de obras",
    description: "Projeto executivo, suprimentos, obra e entrega.",
    tasks: [
      { name: "Projeto executivo", level: 0, durationDays: 15 },
      { name: "Levantamento topográfico", level: 1, durationDays: 5 },
      { name: "Memorial descritivo", level: 1, durationDays: 5 },
      { name: "Licenciamento", level: 0, durationDays: 25 },
      { name: "Alvará aprovado", level: 1, durationDays: 0, milestone: true },
      { name: "Suprimentos", level: 0, durationDays: 20 },
      { name: "Obra", level: 0, durationDays: 60 },
      { name: "Fundação", level: 1, durationDays: 15 },
      { name: "Estrutura", level: 1, durationDays: 25 },
      { name: "Acabamentos", level: 1, durationDays: 20 },
      { name: "Entrega", level: 0, durationDays: 5 },
      { name: "Vistoria final", level: 1, durationDays: 0, milestone: true },
    ],
  },
  {
    key: "marketing",
    name: "Marketing",
    description: "Planejamento, produção, veiculação e análise de campanha.",
    tasks: [
      { name: "Planejamento da campanha", level: 0, durationDays: 8 },
      { name: "Definição de público", level: 1, durationDays: 3 },
      { name: "Orçamento aprovado", level: 1, durationDays: 0, milestone: true },
      { name: "Produção de material", level: 0, durationDays: 12 },
      { name: "Roteiro e aprovação", level: 1, durationDays: 5 },
      { name: "Arte final", level: 1, durationDays: 5 },
      { name: "Veiculação", level: 0, durationDays: 21 },
      { name: "Análise de resultados", level: 0, durationDays: 5 },
      { name: "Relatório final", level: 1, durationDays: 0, milestone: true },
    ],
  },
];

export function getTemplate(key: string | null | undefined): ProjectTemplate | undefined {
  if (!key) return undefined;
  return PROJECT_TEMPLATES.find((t) => t.key === key);
}

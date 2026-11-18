# Importação de dados

> Complementa o [guia de uso](guia-de-uso.md). Os atalhos de teclado estão em
> [atalhos.md](atalhos.md).

O botão **Importar** (barra de comandos, com um projeto aberto) aceita arquivos
**CSV** e **JSON** no formato do produto. O fluxo é sempre:

1. escolher o arquivo (e o modo **Substituir** ou **Mesclar**);
2. conferir o **mapeamento de colunas** (somente CSV — já sugerido);
3. revisar o **relatório de pré-validação** (linhas válidas, linhas com erro,
   linha e motivo de cada erro, com opção de exportar o relatório);
4. confirmar: tudo é aplicado em **uma única transação** — se algo falhar,
   nada muda e você pode tentar de novo.

## Modos

- **Substituir**: o arquivo define o conteúdo. JSON apaga tarefas, vínculos,
  recursos, atribuições, campos personalizados e baselines do projeto antes de
  gravar (calendários e itens de biblioteca são mantidos); CSV apaga as
  tarefas (vínculos e atribuições vão junto por cascata).
- **Mesclar**: nada é apagado. Tarefas são casadas pelo **código WBS**,
  recursos e baselines pelo **nome** e campos personalizados por nome + tipo;
  o que já existe é atualizado, o que falta é criado.

## CSV

- **Codificação**: UTF-8 (com ou sem BOM); arquivos legados em
  Windows-1252 também são aceitos.
- **Delimitador** detectado automaticamente entre `;`, `,`, tabulação e `|`.
- A **primeira linha** é o cabeçalho; as colunas são mapeadas para os campos
  do produto (sugestão automática, ajustável antes de validar).

### Template

Baixe o template pronto no próprio diálogo (**Baixar template CSV**). Ele tem
este formato:

```csv
WBS,Nome,Início,Término,Duração,% Concluído,Recursos,Predecessores,Notas,Marco
1,Planejamento,05/01/2026,09/01/2026,5d,0,, ,Fase inicial,não
1.1,Levantamento,05/01/2026,06/01/2026,2d,0,Ana,,Reuniões,não
1.2,Desenvolvimento,07/01/2026,09/01/2026,3d,0,Bia,1.1,,não
2,Entrega,12/01/2026,12/01/2026,1d,0,,,Marco de entrega,sim
```

### Formatos por coluna

| Coluna | Formato | Observações |
| --- | --- | --- |
| WBS | `1`, `1.2`, `1.2.3` | define a hierarquia; vazio = raiz numerada na ordem do arquivo |
| Nome | texto | obrigatório |
| Início / Término | `dd/MM/aaaa`, `+2d`, `hoje` | data inválida recusa a linha |
| Duração | `5d`, `40h`, `2 semanas` | |
| % Concluído | número de 0 a 100 | |
| Recursos | nomes separados por `,` | pessoa que não existe é criada |
| Predecessores | códigos WBS separados por `,` | referência inexistente recusa a linha (tudo-ou-nada) |
| Notas | texto | |
| Marco | `sim` / `não` | marco tem duração zero |

**Limite**: até 50.000 linhas por importação; acima disso o sistema avisa e
pede confirmação antes de processar.

**Relatório de erros**: linhas recusadas aparecem com número e motivo no
diálogo, e podem ser exportados em CSV (**Exportar relatório**). Somente as
linhas válidas são importadas.

## JSON (formato do produto)

Formato versionado, o mesmo que a **Exportação JSON** gera — exportar e
importar reproduz o mesmo projeto (tarefas, vínculos, recursos, atribuições,
baselines e campos personalizados). Exemplo mínimo (também disponível em
**Baixar exemplo JSON**):

```json
{
  "format": "ontarget",
  "version": 1,
  "data": {
    "tasks": [
      {
        "id": "t1",
        "parentId": null,
        "outlineNumber": "1",
        "sortOrder": 0,
        "name": "Planejamento",
        "start": 1767571200000,
        "finish": 1767916800000,
        "duration": 162000000,
        "percentComplete": 0
      },
      {
        "id": "t2",
        "parentId": "t1",
        "outlineNumber": "1.1",
        "sortOrder": 1,
        "name": "Levantamento",
        "start": 1767571200000,
        "finish": 1767657600000,
        "duration": 64800000,
        "percentComplete": 0
      }
    ],
    "taskLinks": [],
    "resources": [{ "id": "r1", "name": "Ana", "type": "work", "maxUnits": 1, "standardRate": 100 }],
    "assignments": [{ "id": "a1", "taskId": "t1", "resourceId": "r1", "units": 1 }],
    "customFields": [],
    "customFieldValues": [],
    "baselines": [],
    "baselineValues": []
  }
}
```

- `format` deve ser `"ontarget"` e `version` `1` (versões maiores são
  recusadas com aviso). Por compatibilidade, arquivos gerados antes do rename
  da aplicação com `"format": "e-project"` também são aceitos na leitura.
- Datas são epoch em **milissegundos UTC-naive** (mesma convenção do produto);
  durações também em milissegundos.
- Os `id` são apenas referências internas do arquivo — ao importar, ids novos
  são gerados e as referências (pai, vínculos, atribuições) são remapeadas.
- Toda tarefa precisa de `name` e `outlineNumber`; linhas com erro não
  impedem a importação das válidas, mas aparecem no relatório.

## Ver também

- [guia-de-uso.md](guia-de-uso.md) — visão geral do produto
- [atalhos.md](atalhos.md) — atalhos de teclado

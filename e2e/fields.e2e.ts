import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Campos personalizados (specs/custom-fields): criação dos tipos lista e
 * fórmula com validação (sem `eval`), coluna editável na grade, atualização
 * da fórmula quando a duração muda e exclusão com aviso de uso + confirmação.
 */

interface Detail {
  data: {
    customFields: Array<{ id: string; name: string; dataType: string }>;
    customFieldValues: Array<{
      fieldId: string;
      entityId: string;
      valueText: string | null;
      valueNum: number | null;
    }>;
    tasks: Array<{ id: string }>;
  };
}

async function detail(request: APIRequestContext, projectId: string): Promise<Detail> {
  return (await (await request.get(`/api/projects/${projectId}`)).json()) as Detail;
}

/** N-ésimo dia útil a partir de segunda (inclusive). */
function nthWorkingDay(start: number, count: number): number {
  let day = start;
  let found = 1;
  while (found < count) {
    day += DAY;
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) found += 1;
  }
  return day;
}

test("campos personalizados: lista editável, fórmula validada e exclusão com confirmação", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const created = await request.post("/api/projects", {
    data: { name: `Campos E2E ${Date.now()}`, templateKey: "vazio" },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const projectId = project.id;

  const now = Date.now();
  const uid = Date.now().toString(36);
  const start = Date.UTC(2026, 0, 5); // segunda-feira fixa
  const seeded = await request.post(`/api/projects/${projectId}/sync`, {
    data: {
      upserts: {
        tasks: [
          {
            id: `${uid}-t`,
            projectId,
            parentId: null,
            outlineLevel: 0,
            outlineNumber: "1",
            sortOrder: 0,
            name: "Tarefa alvo",
            start,
            finish: nthWorkingDay(start, 6), // 48h em dias de 9h (6 dias úteis)
            duration: 48 * HOUR, // > 5d (40h) da fórmula
            durationUnit: "day",
            percentComplete: 0,
            isSummary: false,
            isMilestone: false,
            isInactive: false,
            schedulingMode: "auto",
            taskType: "fixed_duration",
            effortDriven: true,
            priority: 500,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    },
  });
  expect(seeded.status()).toBe(200);

  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "1");
  await expect(page.getByTestId("task-row")).toHaveCount(1);

  // --- cria os campos ---------------------------------------------------------
  await page.getByTestId("fields-toggle").click();
  await expect(page.getByTestId("fields-panel")).toBeVisible();
  await expect(page.getByTestId("fields-empty")).toBeVisible();

  // lista de valores (cenário da spec)
  await page.getByTestId("field-name").fill("Prioridade");
  await page.getByTestId("field-type").selectOption("list");
  await page.getByTestId("field-list-values").fill("Baixa, Média, Alta");
  await page.getByTestId("field-add").click();
  await expect(page.getByTestId("field-row")).toHaveCount(1);

  // fórmula válida (cenário da spec)
  await page.getByTestId("field-name").fill("Tamanho");
  await page.getByTestId("field-type").selectOption("formula");
  await page.getByTestId("field-formula").fill('IIF([Duração] > 5d, "Longo", "Curto")');
  await page.getByTestId("field-add").click();
  await expect(page.getByTestId("field-row")).toHaveCount(2);

  // fórmula inválida é rejeitada e nada é gravado (cenário da spec)
  await page.getByTestId("field-name").fill("Quebrada");
  await page.getByTestId("field-type").selectOption("formula");
  await page.getByTestId("field-formula").fill("foo([Duração])");
  await page.getByTestId("field-add").click();
  await expect(page.getByTestId("field-error")).toContainText("Função desconhecida");
  await expect(page.getByTestId("field-row")).toHaveCount(2);

  await page.getByTestId("fields-close").click();
  await expect(page.getByTestId("fields-panel")).toHaveCount(0);

  // --- as colunas aparecem na grade -------------------------------------------
  const headers = page.locator('[data-testid^="header-cf:"]');
  await expect(headers).toHaveCount(2);

  await expect(page.getByTestId("status-save")).toHaveText("Salvo");
  const after = await detail(request, projectId);
  expect(after.data.customFields.map((field) => field.name).sort()).toEqual([
    "Prioridade",
    "Tamanho",
  ]);
  const listField = after.data.customFields.find((field) => field.name === "Prioridade")!;
  const formulaField = after.data.customFields.find((field) => field.name === "Tamanho")!;
  const taskId = after.data.tasks[0]!.id;

  const listCell = page.locator(`[data-testid="cell-cf:${listField.id}"]`);
  const formulaCell = page.locator(`[data-testid="cell-cf:${formulaField.id}"]`);

  // fórmula avaliada: 48h > 5d → Longo
  await expect(formulaCell).toHaveText("Longo");

  // --- edita a lista na célula (seletor correspondente) ------------------------
  await listCell.dblclick();
  await page.getByTestId("cell-editor").selectOption("Média");
  await expect(listCell).toHaveText("Média");

  // --- a fórmula acompanha a duração (1d → Curto) ----------------------------
  const row = page.getByTestId("task-row").first();
  await row.getByTestId("cell-duration").dblclick();
  await page.getByTestId("cell-editor").fill("1d");
  await page.getByTestId("cell-editor").press("Enter");
  await expect(row.getByTestId("cell-duration")).toHaveText("1d");
  await expect(formulaCell).toHaveText("Curto");

  // --- persistência ------------------------------------------------------------
  await expect(page.getByTestId("status-save")).toHaveText("Salvo");
  const persisted = await detail(request, projectId);
  const listValue = persisted.data.customFieldValues.find(
    (value) => value.fieldId === listField.id && value.entityId === taskId,
  );
  expect(listValue?.valueText).toBe("Média");
  // fórmula não guarda valor: é calculada a cada leitura
  expect(persisted.data.customFieldValues.some((value) => value.fieldId === formulaField.id)).toBe(
    false,
  );

  await page.reload();
  await expect(page.getByTestId("task-row")).toHaveCount(1);
  await expect(
    page.locator(`[data-testid="cell-cf:${listField.id}"]`),
  ).toHaveText("Média");
  await expect(
    page.locator(`[data-testid="cell-cf:${formulaField.id}"]`),
  ).toHaveText("Curto");

  // --- exclusão em uso: aviso com a contagem e confirmação --------------------
  await page.getByTestId("fields-toggle").click();
  // o nome vive no value do input: identifica a linha pela posição (criada 1ª)
  const priorityRow = page.getByTestId("field-row").nth(0);
  await expect(priorityRow.locator('[data-testid="field-row-name"]')).toHaveValue("Prioridade");
  await priorityRow.getByTestId("field-remove").click();
  await expect(page.getByTestId("field-error")).toContainText("em uso em 1 tarefa");
  await expect(priorityRow.getByTestId("field-confirm")).toBeVisible();
  await expect(page.getByTestId("field-row")).toHaveCount(2); // nada foi removido

  await priorityRow.getByTestId("field-confirm").click();
  await expect(page.getByTestId("field-row")).toHaveCount(1);

  expect(errors).toEqual([]);
});

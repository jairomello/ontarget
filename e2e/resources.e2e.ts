import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Cadastro de pessoas e equipes (specs/resources — "Cadastro de recursos em
 * equipes"): criar equipe e pessoa pela interface, confirmar que a pessoa fica
 * disponível para atribuição (atribuição aceita pela API) e que tudo persiste
 * após recarregar.
 */

interface ProjectDetail {
  data: {
    teams: Array<{ id: string; name: string; color: string }>;
    resources: Array<{
      id: string;
      name: string;
      initials: string | null;
      teamId: string | null;
      maxUnits: number;
      standardRate: number;
      calendarId: string | null;
      type: string;
    }>;
    assignments: Array<{ id: string; resourceId: string; taskId: string; units: number }>;
    tasks: Array<{ id: string }>;
    calendars: Array<{ id: string }>;
  };
}

async function detail(
  request: APIRequestContext,
  projectId: string,
): Promise<ProjectDetail> {
  return (await (await request.get(`/api/projects/${projectId}`)).json()) as ProjectDetail;
}

test("criar equipe e pessoa e disponibilizá-las para atribuição", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const created = await request.post("/api/projects", {
    data: { name: `Recursos E2E ${Date.now()}`, templateKey: "vazio" },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const projectId = project.id;

  // tarefa para a qual a pessoa será atribuída (disponibilidade)
  const now = Date.now();
  const taskSync = await request.post(`/api/projects/${projectId}/sync`, {
    data: {
      upserts: {
        tasks: [
          {
            id: `${Date.now().toString(36)}-t`,
            projectId,
            parentId: null,
            outlineLevel: 0,
            outlineNumber: "1",
            sortOrder: 0,
            name: "Tarefa alvo",
            start: Date.UTC(2026, 0, 5),
            finish: Date.UTC(2026, 0, 5),
            duration: 9 * 60 * 60 * 1000,
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
  expect(taskSync.status()).toBe(200);

  // equipes são globais (sem projeto) e o banco do E2E persiste entre
  // execuções: limpa as herdadas para contagens determinísticas
  const initial = await detail(request, projectId);
  const staleTeams = initial.data.teams.map((team) => team.id);
  if (staleTeams.length > 0) {
    const cleanup = await request.post(`/api/projects/${projectId}/sync`, {
      data: { deletes: { teams: staleTeams } },
    });
    expect(cleanup.status()).toBe(200);
    expect((await detail(request, projectId)).data.teams).toHaveLength(0);
  }

  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("task-sheet")).toBeVisible();

  // --- cria a equipe -------------------------------------------------------
  await page.getByTestId("resources-toggle").click();
  await expect(page.getByTestId("resources-panel")).toBeVisible();
  await page.getByTestId("team-name").fill("Núcleo de Dados");
  await page.getByTestId("team-color").fill("#22c55e");
  await page.getByTestId("team-add").click();

  const teamRow = page.getByTestId("team-row");
  await expect(teamRow).toHaveCount(1);
  // o nome vive no value do input da linha
  await expect(teamRow.locator('[data-testid="team-row-name"]')).toHaveValue("Núcleo de Dados");

  // --- cria a pessoa com todos os campos do cadastro ------------------------
  await page.getByTestId("person-name").fill("Ana Silva");
  await page.getByTestId("person-initials").fill("AS");
  await page.getByTestId("person-units").fill("1.5");
  await page.getByTestId("person-rate").fill("120");
  await page.getByTestId("person-team").selectOption({ label: "Núcleo de Dados" });
  await page.getByTestId("person-calendar").selectOption({ label: "Calendário padrão" });
  await page.getByTestId("person-add").click();

  const personRow = page.getByTestId("person-row");
  await expect(personRow).toHaveCount(1);
  await expect(personRow).toContainText("Ana Silva");
  await expect(personRow).toContainText("Núcleo de Dados");

  // --- persistência e campos gravados ---------------------------------------
  await expect(page.getByTestId("status-save")).toHaveText("Salvo");

  const after = await detail(request, projectId);
  expect(after.data.teams).toHaveLength(1);
  expect(after.data.teams[0]).toMatchObject({ name: "Núcleo de Dados", color: "#22c55e" });
  expect(after.data.resources).toHaveLength(1);
  expect(after.data.resources[0]).toMatchObject({
    name: "Ana Silva",
    initials: "AS",
    maxUnits: 1.5,
    standardRate: 120,
    type: "work",
    teamId: after.data.teams[0]!.id,
    calendarId: after.data.calendars[0]!.id,
  });

  // --- disponível para atribuição: a API aceita a atribuição à tarefa -------
  const taskId = after.data.tasks[0]!.id;
  const resource = after.data.resources[0]!;
  const assignmentSync = await request.post(`/api/projects/${projectId}/sync`, {
    data: {
      upserts: {
        assignments: [
          {
            id: `${Date.now().toString(36)}-as`,
            projectId,
            taskId,
            resourceId: resource.id,
            units: 1,
          },
        ],
      },
    },
  });
  expect(assignmentSync.status()).toBe(200);

  const withAssignment = await detail(request, projectId);
  expect(withAssignment.data.assignments).toHaveLength(1);
  expect(withAssignment.data.assignments[0]).toMatchObject({
    resourceId: resource.id,
    taskId,
    units: 1,
  });

  // --- recarrega: cadastro restaurado ---------------------------------------
  await page.reload();
  await expect(page.getByTestId("task-sheet")).toBeVisible();
  await page.getByTestId("resources-toggle").click();
  await expect(page.getByTestId("team-row")).toHaveCount(1);
  await expect(page.getByTestId("person-row")).toHaveCount(1);
  await expect(page.getByTestId("person-row")).toContainText("Ana Silva");

  // --- remoções --------------------------------------------------------------
  await page.getByTestId("person-remove").click();
  await expect(page.getByTestId("person-row")).toHaveCount(0);
  await page.getByTestId("team-remove").click();
  await expect(page.getByTestId("team-row")).toHaveCount(0);

  await expect(page.getByTestId("status-save")).toHaveText("Salvo");
  const emptied = await detail(request, projectId);
  expect(emptied.data.resources).toHaveLength(0);
  expect(emptied.data.teams).toHaveLength(0);
  // a tarefa permanece intacta
  expect(emptied.data.tasks).toHaveLength(1);

  expect(errors).toEqual([]);
});

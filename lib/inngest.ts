import { Inngest } from "inngest";
import { prisma } from "@/lib/db";
import { GraphSchema } from "@/lib/graph";
import { runGraph } from "@/lib/interpreter";
import { isScheduleDue, type Schedule } from "@/lib/schedule";
import { sendAlert } from "@/lib/notify";

export const inngest = new Inngest({ id: "workflow-builder" });

// ฟังก์ชันทดสอบ: รับ event "test/hello" แล้ว log
// Inngest v4: trigger ย้ายเข้ามาใน config เป็น `triggers` (createFunction รับ 2 args)
export const hello = inngest.createFunction(
  { id: "hello", triggers: [{ event: "test/hello" }] },
  async ({ event, step }) => {
    await step.run("greet", async () => `สวัสดี ${event.data.name ?? "world"}`);
    return { ok: true };
  },
);

/**
 * รัน workflow (D2): event ส่ง { workflowId, payload } → โหลด graph จาก DB
 * function retries: 0 — เราคุม retry เองราย node ใน interpreter (D3)
 */
export const runWorkflow = inngest.createFunction(
  { id: "run-workflow", retries: 0, triggers: [{ event: "workflow.run" }] },
  async ({ event, step }) => {
    const { runId: providedRunId, workflowId, payload, trigger, startNodeId } =
      event.data as {
        runId?: string;
        workflowId: string;
        payload?: Record<string, unknown>;
        trigger?: string;
        startNodeId?: string;
      };
    const wf = await step.run("load-workflow", () =>
      prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } }),
    );
    const graph = GraphSchema.parse(wf.graph);
    const run = providedRunId
      ? await step.run("mark-running", () =>
          prisma.run.update({ where: { id: providedRunId }, data: { status: "running" } }))
      : await step.run("create-run", () =>
          prisma.run.create({ data: { workflowId, status: "running", trigger: trigger ?? "manual" } })
    );
    try {
      const result = await runGraph(graph, run.id, step, payload ?? {}, {
        startNodeId,
      });
      await step.run("finalize", () =>
        prisma.run.update({
          where: { id: run.id },
          data: { status: result.status },
        }),
      );
      if (result.status === "failed") {
        await step.run("alert", async () => {
          const fails = await prisma.nodeRun.findMany({
            where: { runId: run.id, status: "failed" },
          });
          await sendAlert(
            `❌ Workflow "${wf.name}" failed`,
            `Run: ${run.id}\n` +
              fails.map((f) => `- ${f.nodeId}: ${f.error}`).join("\n"),
          );
        });
      }
      return { runId: run.id, status: result.status };
    } catch (e) {
      // crash ที่ไม่คาด → ยังบันทึก Run = failed (Run.status คือความจริง)
      await step.run("finalize-error", () =>
        prisma.run.update({ where: { id: run.id }, data: { status: "failed" } }),
      );
      await step.run("alert-error", () =>
        sendAlert(
          `❌ Workflow "${wf.name}" crashed`,
          `Run: ${run.id}\n${e instanceof Error ? e.message : String(e)}`,
        ),
      );
      throw e;
    }
  },
);

/**
 * scheduler — cron ทุกนาที อ่าน workflow ที่ตั้งเวลา (trigger.config.schedule) → ยิง workflow.run
 * preset (no-dep, UTC): manual · hourly · daily · weekdays · weekly  (ดู lib/schedule.ts)
 * custom cron ค่อยเพิ่ม cron-parser ทีหลัง
 */
export const scheduler = inngest.createFunction(
  { id: "scheduler", triggers: [{ cron: "* * * * *" }] },
  async ({ step }) => {
    const wfs = await step.run("load-workflows", () => prisma.workflow.findMany());
    const now = new Date();
    const due: string[] = [];
    for (const wf of wfs) {
      const parsed = GraphSchema.safeParse(wf.graph);
      if (!parsed.success) continue;
      const trig = parsed.data.nodes.find((n) => n.type === "trigger");
      const sch = trig?.config?.schedule as Schedule | undefined;
      if (isScheduleDue(sch, now)) due.push(wf.id);
    }
    await Promise.all(
      due.map((id) =>
        step.run(`fire-${id}`, () =>
          inngest.send({
            name: "workflow.run",
            data: { workflowId: id, trigger: "schedule", payload: { scheduledAt: now.toISOString() } },
          }),
        ),
      ),
    );
    return { fired: due };
  },
);

export const functions = [hello, runWorkflow];
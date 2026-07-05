import { prisma } from "@/lib/db";
import { isPrismaConnectionError } from "@/lib/prisma-errors";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  success: "badge-success",
  failed: "badge-error",
  skipped: "badge-neutral",
  running: "badge-info",
  queued: "badge-warning",
};

function Badge({ status }: { status: string }) {
  return (
    <span
      className={`badge uppercase tracking-wide ${STATUS_CLASS[status] ?? "badge-neutral"}`}
    >
      {status}
    </span>
  );
}

function Json({ value }: { value: unknown }) {
  if (value == null) return <span className="text-muted">—</span>;
  return <pre className="code-block">{JSON.stringify(value, null, 2)}</pre>;
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let run;
  try {
    run = await prisma.run.findUnique({
      where: { id },
      include: {
        workflow: true,
        nodeRuns: { orderBy: { createdAt: "asc" } },
      },
    });
  } catch (error) {
    if (isPrismaConnectionError(error)) {
      return (
        <main className="mx-auto w-full max-w-3xl px-5 py-10">
          <p className="text-muted">ฐานข้อมูลยังเชื่อมต่อไม่ได้ เปิดหน้า run ไม่ได้ในตอนนี้</p>
          <Link href="/canvas" className="link">
            ← กลับไป canvas
          </Link>
        </main>
      );
    }
    throw error;
  }

  if (!run) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-muted">ไม่พบ run นี้</p>
        <Link href="/canvas" className="link">
          ← กลับไป canvas
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <div className="row-between">
        <h1 className="text-lg font-semibold">
          Run · {run.workflow?.name ?? run.workflowId}
        </h1>
        <Badge status={run.status} />
      </div>
      <div className="mt-1.5 text-xs text-muted">
        {run.id} · trigger: {run.trigger} · {new Date(run.startedAt).toLocaleString()}
      </div>
      <div className="row mb-6 mt-3 gap-3 text-sm">
        <Link href={`/runs/${run.id}`} className="link">
          ↻ Refresh
        </Link>
        <Link href="/canvas" className="link">
          ← Canvas
        </Link>
      </div>

      {run.nodeRuns.length === 0 ? (
        <p className="text-muted">
          ยังไม่มี NodeRun (run อาจกำลังประมวลผล — กด Refresh)
        </p>
      ) : (
        <div className="stack stack-md">
          {run.nodeRuns.map((nr, i) => (
            <div key={nr.id} className="card">
              <div className="row-between mb-3">
                <div className="font-semibold">
                  <span className="mr-2 text-muted">#{i + 1}</span>
                  {nr.nodeId}
                </div>
                <Badge status={nr.status} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="eyebrow mb-1">Input</div>
                  <Json value={nr.input} />
                </div>
                <div>
                  <div className="eyebrow mb-1">Output</div>
                  <Json value={nr.output} />
                </div>
              </div>

              {nr.error && (
                <div className="mt-3">
                  <div className="eyebrow mb-1 text-error">Error</div>
                  <pre className="code-block code-block-error">{nr.error}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

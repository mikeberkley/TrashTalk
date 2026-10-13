import { type Env, sql, now } from "../env";

export class GenerationTiming {
  private started = Date.now();
  private stageStarted = this.started;
  private stage = "initialization";
  private stagesMs: Record<string, number> = {};
  constructor(private createdAt: number) {}
  next(stage: string) {
    const time = Date.now();
    this.stagesMs[this.stage] =
      (this.stagesMs[this.stage] || 0) + time - this.stageStarted;
    this.stage = stage;
    this.stageStarted = time;
  }
  async persist(
    env: Env,
    id: string,
    outcome: string,
    models: { caption: string; image: string },
  ) {
    this.next("finished");
    const detail = {
      outcome,
      models,
      stagesMs: this.stagesMs,
      attemptMs: Date.now() - this.started,
      jobAgeAtStartMs: Math.max(0, this.started - this.createdAt * 1000),
    };
    try {
      await sql(
        env,
        "INSERT INTO audit(kind,object_id,detail,created_at) VALUES(?,?,?,?)",
        "generation_timing",
        id,
        JSON.stringify(detail),
        now(),
      ).run();
    } catch {
      // Diagnostics must never change a completed job or cause a paid retry.
      console.error(
        JSON.stringify({ event: "generation_timing_write_failed", jobId: id }),
      );
    }
  }
}

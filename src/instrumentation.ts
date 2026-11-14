// Starts the job worker inside the Next.js server process (disable with INLINE_WORKER=0).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.INLINE_WORKER !== "0") {
    const { startWorker } = await import("@/lib/jobs/worker");
    startWorker();
  }
}

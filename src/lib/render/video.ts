// Slide-based video: one branded card per scene, cross-faded with FFmpeg. Silent (no audio track).
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { BrandContext, Scene } from "@/lib/ai/types";
import { renderSlidePng } from "./layout";

const run = promisify(execFile);
const FADE = 0.5;
export const MAX_SCENES = 12;

export async function renderSlideVideo(brand: BrandContext, scenes: Scene[], w: number, h: number) {
  const used = scenes.slice(0, MAX_SCENES);
  if (!used.length) throw new Error("No scenes to render");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ucs-video-"));
  try {
    const durations = used.map((s) => Math.min(8, Math.max(2.5, Number(s.duration) || 4)));
    const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
    for (let i = 0; i < used.length; i++) {
      const file = path.join(dir, `s${i}.png`);
      await fs.writeFile(
        file,
        await renderSlidePng(brand, { kicker: used[i].heading, headline: used[i].narration, index: `${i + 1}/${used.length}` }, w, h),
      );
      args.push("-loop", "1", "-t", String(durations[i]), "-i", file);
    }
    let filter = "";
    let last = "0:v";
    let offset = 0;
    for (let i = 1; i < used.length; i++) {
      offset += durations[i - 1] - FADE;
      filter += `[${last}][${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(2)}[v${i}];`;
      last = `v${i}`;
    }
    filter += `[${last}]format=yuv420p[out]`;
    const out = path.join(dir, "out.mp4");
    args.push("-filter_complex", filter, "-map", "[out]", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart", out);
    await run("ffmpeg", args, { timeout: 180_000 });
    const duration = durations.reduce((a, b) => a + b, 0) - FADE * (used.length - 1);
    return { data: await fs.readFile(out), duration: Math.round(duration * 100) / 100, scenesRendered: used.length };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

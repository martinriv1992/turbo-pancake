import { Suspense } from "react";
import { product } from "@/config/product";
import { Flash } from "./client";

export function ProductMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-accent font-mono font-bold text-accent-fg"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
      aria-hidden
    >
      {product.initials}
    </span>
  );
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between border-r border-border bg-surface p-12 lg:flex">
        <div className="flex items-center gap-3">
          <ProductMark />
          <span className="text-sm font-semibold tracking-tight">{product.name}</span>
        </div>
        <div>
          <p className="max-w-md text-5xl font-semibold leading-[1.05] tracking-tight">{product.tagline}</p>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-muted">
            One production system for every brand you run: brand guidelines, video, images, writing, audio and documents,
            with approvals, scheduling and cost control built in.
          </p>
        </div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted">One platform · Unlimited brands · Every format</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <ProductMark />
            <span className="text-sm font-semibold">{product.name}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-muted">{subtitle}</p>
          <Suspense>
            <Flash />
          </Suspense>
          {children}
        </div>
      </section>
    </main>
  );
}

import { Field, Input, Select, Textarea } from "@/components/ui";
import { LANGUAGES } from "@/lib/content/catalog";

type BrandLike = {
  name?: string; tagline?: string | null; website?: string | null; industry?: string | null; market?: string | null;
  description?: string | null; primary_language?: string; palette?: { role?: string; hex: string; name?: string }[];
};

const DEFAULTS: Record<string, string> = { primary: "#15151c", accent: "#ff5c3d", neutral: "#f4f2ec" };

/** Identity fields shared by "create brand" and "edit brand". */
export function BrandIdentityFields({ brand, withColors = true }: { brand?: BrandLike; withColors?: boolean }) {
  const color = (role: string) => brand?.palette?.find((p) => p.role === role) ?? (brand ? undefined : { hex: DEFAULTS[role], name: "" });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Brand name"><Input name="name" defaultValue={brand?.name ?? ""} required /></Field>
      <Field label="Tagline"><Input name="tagline" defaultValue={brand?.tagline ?? ""} /></Field>
      <Field label="Website"><Input name="website" type="url" placeholder="https://" defaultValue={brand?.website ?? ""} /></Field>
      <Field label="Primary language">
        <Select name="language" defaultValue={brand?.primary_language ?? "en"}>
          {LANGUAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </Field>
      <Field label="Industry"><Input name="industry" defaultValue={brand?.industry ?? ""} /></Field>
      <Field label="Market" hint="Countries, regions or segments served."><Input name="market" defaultValue={brand?.market ?? ""} /></Field>
      <Field label="Description" className="sm:col-span-2">
        <Textarea name="description" defaultValue={brand?.description ?? ""} placeholder="What the brand offers, and to whom." />
      </Field>
      {withColors && (
        <div className="sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-muted">Colour palette</span>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["primary", "accent", "neutral"] as const).map((role) => (
              <div key={role} className="flex items-center gap-2 rounded-lg border border-border bg-bg p-2">
                <input
                  type="color" name={`color_${role}`} defaultValue={color(role)?.hex ?? DEFAULTS[role]} aria-label={`${role} colour`}
                  className="h-9 w-10 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <input
                  name={`color_${role}_name`} defaultValue={color(role)?.name ?? ""} placeholder={`${role} colour name`} aria-label={`${role} colour name`}
                  className="w-full min-w-0 bg-transparent text-sm capitalize placeholder:text-muted/70 focus:outline-none"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// The product's own identity. Everything user-visible reads from here, so the product can
// be renamed through environment variables without touching application code.
export const product = {
  name: process.env.NEXT_PUBLIC_APP_NAME || "Universal Content Studio",
  tagline: process.env.NEXT_PUBLIC_APP_TAGLINE || "Create anything. Publish everywhere.",
  get initials() {
    return this.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase();
  },
};

// Centralized product branding (spec §1). Change the visible identity here —
// files, APIs, hooks and internal symbols stay as-is. Env overrides allow the
// final name to be swapped without code edits.

export const brand = {
  name: process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Scout",
  subtitle: process.env.NEXT_PUBLIC_PRODUCT_SUBTITLE ?? "Personal Intelligence",
} as const;

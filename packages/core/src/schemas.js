import { z } from "zod";

// ── shared field types ────────────────────────────────────────────────────

export const StatusEnum = z.enum(["open", "in_progress", "done", "archived"]);
export const AgentStatusEnum = z.enum(["open", "in_progress", "done"]);
export const TitleField = z.string().min(1).max(255);

// ── item schemas ──────────────────────────────────────────────────────────

export const CreateItemSchema = z.object({
  title: TitleField,
  description: z.string().optional(),
  status: StatusEnum.optional(),
});

export const UpdateItemSchema = z.object({
  version: z.number().int(),
  title: TitleField.optional(),
  description: z.string().optional(),
  status: StatusEnum.optional(),
});

// Version optional — ui.js accepts version from If-Match header or body
export const PatchItemBodySchema = z.object({
  version: z.number().int().optional(),
  title: TitleField.optional(),
  description: z.string().optional(),
  status: StatusEnum.optional(),
});

// ── checklist schemas ─────────────────────────────────────────────────────

export const AddChecklistSchema = z.object({
  version: z.number().int(),
  label: z.string().min(1),
  parent_id: z.number().int().positive().optional(),
});

// Version optional — ui.js direct-DB checklist endpoints don't require it
export const AddChecklistBodySchema = z.object({
  label: z.string().min(1),
  parent_id: z.number().int().positive().optional(),
});

export const UpdateChecklistSchema = z.object({
  version: z.number().int(),
  label: z.string().min(1).optional(),
  checked: z.boolean().optional(),
});

export const PatchChecklistBodySchema = z.object({
  label: z.string().min(1).optional(),
  checked: z.boolean().optional(),
});

export const DeleteChecklistSchema = z.object({
  version: z.number().int(),
});

// ── comment schemas ───────────────────────────────────────────────────────

export const AddCommentSchema = z.object({
  body: z.string().min(1),
});

// ── dependency schemas ────────────────────────────────────────────────────

export const AddDependencySchema = z.object({
  version: z.number().int(),
  depends_on_id: z.number().int().positive(),
});

export const RemoveDependencySchema = z.object({
  version: z.number().int(),
});

// ── validation helper ─────────────────────────────────────────────────────

/**
 * Validates `data` against `schema` using safeParse.
 * Throws a descriptive Error on failure (caught upstream as HTTP 400).
 * Returns the parsed (stripped) data on success.
 */
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues ?? [];
    const msg = issues.length
      ? issues.map((i) => {
          const path = i.path && i.path.length ? i.path.join(".") : "body";
          return `${path}: ${i.message}`;
        }).join("; ")
      : String(result.error);
    throw new Error(`Validation error — ${msg}`);
  }
  return result.data;
}

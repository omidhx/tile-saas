import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * اعتبارسنجیِ ورودیِ routeها با zod.
 *
 * ورودیِ بد باید ۴۰۰ بگیرد، نه اینکه به Postgres برسد و ۵۰۰ شود (22P02 برای uuid خراب،
 * 23514 برای enum ناشناخته، TypeError برای فیلدِ گمشده). الگو در هر route:
 *   const body = await req.json().catch(() => null);
 *   const c = await staffCtx(body?.tenantId); if ("err" in c) return c.err;   // اول احراز
 *   const p = parse(Schema, body); if ("err" in p) return p.err;              // بعد شکلِ ورودی
 */

/** همان چیزی که ستونِ uuidِ Postgres می‌پذیرد (هر نسخه)، نه فقط UUID استانداردِ RFC. */
export const id = z.guid();
export const isId = (v: unknown): v is string => id.safeParse(v).success;

/** عددِ صحیحِ نامنفی: متراژ، تعداد کارتن، پول (قانون ۷: هرگز float). */
export const count = z.number().int().nonnegative();
export const positive = z.number().int().positive();

export function parse<S extends z.ZodType>(
  schema: S, input: unknown,
): { data: z.output<S> } | { err: NextResponse } {
  const r = schema.safeParse(input);
  if (r.success) return { data: r.data };
  const fields = [...new Set(r.error.issues.map((i) => i.path.join(".") || "(body)"))];
  return { err: NextResponse.json({ error: "invalid", fields }, { status: 400 }) };
}

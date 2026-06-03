import { ZodSchema, ZodError } from "zod";
import { UnprocessableEntity } from "@/lib/errors";

/**
 * Parse and validate a plain object against a Zod schema.
 * Throws UnprocessableEntity (422) if validation fails.
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = formatZodError(result.error);
    throw new UnprocessableEntity("validation_error", { issues });
  }
  return result.data;
}

/**
 * Parse and validate the JSON body of a Next.js request.
 * Returns validated data of type T.
 */
export async function validateBody<T>(
  request: Request,
  schema: ZodSchema<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new UnprocessableEntity("invalid_json");
  }
  return validate(schema, raw);
}

function formatZodError(err: ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

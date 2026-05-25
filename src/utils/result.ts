export interface ToolTextResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function ok(payload: unknown): ToolTextResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

export function err(message: string): ToolTextResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export async function safe(
  fn: () => Promise<unknown>
): Promise<ToolTextResult> {
  try {
    const out = await fn();
    return ok(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(msg);
  }
}

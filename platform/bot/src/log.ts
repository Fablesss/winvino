/** Одна JSON-строка на событие, как в логах API: их проще искать по updateId (он же X-Request-Id в API). */
export type BotLogger = (event: string, fields?: Record<string, unknown>) => void;

export const logJsonLine: BotLogger = (event, fields = {}) => {
  console.log(JSON.stringify({ event, ...fields }));
};

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

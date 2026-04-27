export function formatDate(date: Date): string {
  return date.toISOString();
}

export function parseInput(input: string): Record<string, unknown> {
  return JSON.parse(input);
}

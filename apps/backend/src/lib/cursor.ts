export function parseOffset(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const n = Number(cursor);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

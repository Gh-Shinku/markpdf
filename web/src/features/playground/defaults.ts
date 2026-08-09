export function getDefaultPlaygroundPage(project: {
  toc_start: number;
  page_count: number;
}): string {
  const tocStart = Number(project.toc_start);
  const pageCount = Number(project.page_count);
  if (!Number.isFinite(pageCount) || pageCount < 1) return "1";
  if (Number.isInteger(tocStart) && tocStart >= 1 && tocStart <= pageCount) {
    return String(tocStart);
  }
  return "1";
}

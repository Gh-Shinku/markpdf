import type { Project } from "./types";

export function formatDate(value: string | null): string {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function makeBookmarkedFilename(project: Project): string {
  return `${project.pdf_filename.replace(/\.pdf$/i, "")}_bookmarked.pdf`;
}

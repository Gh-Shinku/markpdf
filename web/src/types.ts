export type Status =
  | { kind: "idle"; message: string }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export type ValidationIssue = {
  message: string;
};

export type ValidationSnapshot = {
  valid: boolean;
  bookmark_count: number;
  checked_at: string;
  issues: ValidationIssue[];
};

export type Project = {
  id: string;
  name: string;
  pdf_filename: string;
  toc_filename: string | null;
  page_offset: number;
  page_count: number;
  created_at: string;
  updated_at: string;
  toc_updated_at: string;
  generated_at: string | null;
  last_validation: ValidationSnapshot | null;
};

export type SettingsState = {
  base_url: string;
  model: string;
  has_api_key: boolean;
  api_key_hint: string;
};

export type SettingsDraft = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type PreviewPdf = {
  url: string;
  filename: string;
};

export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed";

export type GenerationJob = {
  id: string;
  type: "generate_toc";
  project_id: string;
  status: GenerationJobStatus;
  message: string;
  toc_start: number;
  toc_end: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result: {
    project?: Project;
    stats?: Record<string, unknown>;
  } | null;
};

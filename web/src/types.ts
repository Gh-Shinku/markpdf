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
  toc_start: number;
  toc_end: number;
  inject_toc_page: boolean;
  provider_id: string | null;
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

export type VlmProviderStatus = "unverified" | "verified" | "failed";

export type VlmProvider = {
  id: string;
  name: string;
  base_url: string;
  model: string;
  has_api_key: boolean;
  api_key_hint: string;
  verification_status: VlmProviderStatus;
  verification_message: string;
  verified_at: string | null;
};

export type VlmProviderDraft = {
  id?: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type TocFile = {
  id: string;
  name: string;
  kind: "manual" | "generated";
  created_at: string | null;
  updated_at: string | null;
  source_job_id: string | null;
  provider?: Pick<VlmProvider, "id" | "name" | "base_url" | "model"> | null;
};

export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed";

export type GenerationJobProgress = {
  phase: "queued" | "rendering" | "scanning" | "processing" | "saving" | "completed" | "failed";
  current_page: number | null;
  completed_pages: number;
  total_pages: number;
  source: "vlm" | "cache" | null;
  entries: number | null;
};

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
  progress: GenerationJobProgress;
  provider: Pick<VlmProvider, "id" | "name" | "base_url" | "model"> | null;
  result: {
    project?: Project;
    toc_file?: TocFile;
    stats?: Record<string, unknown>;
  } | null;
};

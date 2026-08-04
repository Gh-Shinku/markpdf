export type Status =
  | { kind: "idle"; message: string }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export type View =
  | { kind: "home" }
  | { kind: "workspace"; projectId: string }
  | { kind: "settings"; returnProjectId?: string };

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

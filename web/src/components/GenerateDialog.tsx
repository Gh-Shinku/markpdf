import { Wand2, X } from "lucide-react";
import type { Project, VlmProvider } from "../types";

type GenerateDialogProps = {
  project: Project;
  tocStart: string;
  tocEnd: string;
  providers: VlmProvider[];
  providerId: string;
  onTocStartChange: (value: string) => void;
  onTocEndChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onCancel: () => void;
  onGenerate: () => void;
};

export function GenerateDialog({
  project,
  tocStart,
  tocEnd,
  providers,
  providerId,
  onTocStartChange,
  onTocEndChange,
  onProviderChange,
  onCancel,
  onGenerate
}: GenerateDialogProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="generate-title">
        <div className="modal-header">
          <h2 id="generate-title">Generate TOC JSON</h2>
          <button className="secondary-action icon-only" type="button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <p className="warning-text">
          The generated result will overwrite the saved JSON for this project.
        </p>
        <div className="range-grid">
          <label>
            <span>VLM API</span>
            <select value={providerId} onChange={(event) => onProviderChange(event.target.value)}>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} - {provider.model}</option>)}
            </select>
          </label>
          <label>
            <span>TOC start page</span>
            <input
              value={tocStart}
              type="number"
              min="1"
              onChange={(event) => onTocStartChange(event.target.value)}
            />
          </label>
          <label>
            <span>TOC end page</span>
            <input
              value={tocEnd}
              type="number"
              min="1"
              max={project.page_count}
              onChange={(event) => onTocEndChange(event.target.value)}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-action" type="button" onClick={onGenerate}>
            <Wand2 size={16} />
            Generate and Replace
          </button>
        </div>
      </section>
    </div>
  );
}

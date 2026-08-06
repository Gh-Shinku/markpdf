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
  onGenerate,
}: GenerateDialogProps) {
  return (
    <div className="generate-backdrop" role="presentation">
      <section
        className="generate-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-title"
      >
        <div className="generate-modal-header">
          <div>
            <p className="section-kicker">Generation</p>
            <h2 id="generate-title">AI Generate</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="generate-hint">
          The generated result is applied to the PDF and saved as a new TOC file.
        </p>
        <div className="generate-form">
          <label>
            <span>VLM API</span>
            <select value={providerId} onChange={(event) => onProviderChange(event.target.value)}>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <div className="generate-form-row">
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
        </div>
        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-action" type="button" onClick={onGenerate}>
            <Wand2 size={16} aria-hidden="true" />
            Generate and Replace
          </button>
        </div>
      </section>
    </div>
  );
}

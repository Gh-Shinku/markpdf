import { AlertTriangle, X } from "lucide-react";

type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  const confirmClassName = tone === "danger" ? "danger-action" : "primary-action";

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-header">
          <div className="confirm-title">
            <AlertTriangle size={18} />
            <h2 id="confirm-title">{title}</h2>
          </div>
          <button className="secondary-action icon-only" type="button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <p className="confirm-message">{message}</p>
        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={confirmClassName} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

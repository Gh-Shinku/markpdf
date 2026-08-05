import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { Status } from "../types";

type StatusLineProps = {
  status: Status;
};

export function StatusLine({ status }: StatusLineProps) {
  if (status.kind === "idle") {
    return null;
  }

  const icon =
    status.kind === "loading" ? (
      <Loader2 className="spin" size={16} />
    ) : status.kind === "success" ? (
      <CheckCircle2 size={16} />
    ) : (
      <AlertCircle size={16} />
    );

  return (
    <div className={`status-pill ${status.kind}`}>
      {icon}
      <span>{status.message}</span>
    </div>
  );
}

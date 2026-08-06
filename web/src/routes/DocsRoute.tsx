import { useNavigate } from "react-router-dom";
import { DocsView } from "../components/DocsView";

export function DocsRoute() {
  const navigate = useNavigate();
  return (
    <DocsView
      onOpenHome={() => navigate("/")}
      onOpenTasks={() => navigate("/tasks")}
      onOpenSettings={() => navigate("/settings")}
    />
  );
}

import { Navigate, Route, Routes } from "react-router-dom";
import { useThemePreference } from "./hooks/useThemePreference";
import { DocsRoute } from "./routes/DocsRoute";
import { HomeRoute } from "./routes/HomeRoute";
import { SettingsRoute } from "./routes/SettingsRoute";
import { TasksRoute } from "./routes/TasksRoute";
import { WorkspaceRoute } from "./routes/WorkspaceRoute";

export function App() {
  useThemePreference();

  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/docs" element={<DocsRoute />} />
      <Route path="/settings" element={<SettingsRoute />} />
      <Route path="/tasks" element={<TasksRoute />} />
      <Route path="/projects/:projectId" element={<WorkspaceRoute />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}

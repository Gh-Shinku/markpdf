import { BookMarked, FolderOpen, Settings } from "lucide-react";

type AppNavigationProps = {
  active: "home" | "settings" | "workspace";
  onHome: () => void;
  onSettings: () => void;
};

export function AppNavigation({
  active,
  onHome,
  onSettings
}: AppNavigationProps) {
  return (
    <aside className="app-navigation" aria-label="Application navigation">
      <button className="app-mark" type="button" aria-label="All projects" onClick={onHome}>
        <BookMarked size={21} aria-hidden="true" />
      </button>
      <nav className="navigation-actions">
        <button
          className={`nav-action${active === "home" ? " active" : ""}`}
          type="button"
          aria-current={active === "home" ? "page" : undefined}
          onClick={onHome}
          title="Projects"
        >
          <FolderOpen size={18} aria-hidden="true" />
          <span>Projects</span>
        </button>
      </nav>
      <button
        className={`nav-action nav-settings${active === "settings" ? " active" : ""}`}
        type="button"
        aria-current={active === "settings" ? "page" : undefined}
        onClick={onSettings}
        title="Settings"
      >
        <Settings size={18} aria-hidden="true" />
        <span>Settings</span>
      </button>
    </aside>
  );
}

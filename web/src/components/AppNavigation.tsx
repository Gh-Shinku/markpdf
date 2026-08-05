import { BookMarked, FolderOpen, ListChecks, Settings } from "lucide-react";
import styles from "./AppNavigation.module.css";

type AppNavigationProps = {
  active: "home" | "settings" | "tasks" | "workspace";
  onHome: () => void;
  onTasks: () => void;
  onSettings: () => void;
};

export function AppNavigation({ active, onHome, onTasks, onSettings }: AppNavigationProps) {
  return (
    <aside className={styles.navigation} aria-label="Application navigation">
      <button className={styles.mark} type="button" aria-label="All projects" onClick={onHome}>
        <BookMarked size={21} aria-hidden="true" />
      </button>
      <nav className={styles.actions}>
        <button
          className={`${styles.action}${active === "home" ? ` ${styles.active}` : ""}`}
          type="button"
          aria-current={active === "home" ? "page" : undefined}
          onClick={onHome}
          title="Projects"
        >
          <FolderOpen size={18} aria-hidden="true" />
          <span>Projects</span>
        </button>
        <button
          className={`${styles.action}${active === "tasks" ? ` ${styles.active}` : ""}`}
          type="button"
          aria-current={active === "tasks" ? "page" : undefined}
          onClick={onTasks}
          title="Tasks"
        >
          <ListChecks size={18} aria-hidden="true" />
          <span>Tasks</span>
        </button>
      </nav>
      <button
        className={`${styles.action} ${styles.settings}${active === "settings" ? ` ${styles.active}` : ""}`}
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

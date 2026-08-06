import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./PreviewSettingsMenu.module.css";

type PreviewSettingsMenuProps = {
  pageOffset: string;
  injectTocPage: boolean;
  onPageOffsetChange: (value: string) => void;
  onInjectTocPageChange: (value: boolean) => void;
};

export function PreviewSettingsMenu({
  pageOffset,
  injectTocPage,
  onPageOffsetChange,
  onInjectTocPageChange,
}: PreviewSettingsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className={styles.menu} ref={menuRef}>
      <button
        className={styles.trigger}
        type="button"
        aria-label="Preview settings"
        aria-controls={menuId}
        aria-expanded={isOpen}
        title="Preview settings"
        onClick={() => setIsOpen((value) => !value)}
      >
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className={styles.popover} id={menuId} role="dialog" aria-label="Preview settings">
          <label className={styles.field}>
            <span>Page offset</span>
            <input
              type="number"
              step="1"
              value={pageOffset}
              onChange={(event) => onPageOffsetChange(event.target.value)}
            />
          </label>
          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={injectTocPage}
              onChange={(event) => onInjectTocPageChange(event.target.checked)}
            />
            <span>注入目录 page</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}

import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

const DEFAULT_SPLIT_PERCENT = 48;
export const MIN_SPLIT_PERCENT = 30;
export const MAX_SPLIT_PERCENT = 70;

function clamp(value: number): number {
  return Math.min(MAX_SPLIT_PERCENT, Math.max(MIN_SPLIT_PERCENT, value));
}

export function useWorkspaceSplit(workspaceRef: RefObject<HTMLElement | null>) {
  const [splitPercent, setSplitPercent] = useState(DEFAULT_SPLIT_PERCENT);
  const [isResizing, setIsResizing] = useState(false);
  const isDraggingRef = useRef(false);

  function updateSplit(clientX: number) {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (bounds?.width) {
      setSplitPercent(clamp(((clientX - bounds.left) / bounds.width) * 100));
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    isDraggingRef.current = true;
    setIsResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSplit(event.clientX);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (isDraggingRef.current) {
      event.preventDefault();
      updateSplit(event.clientX);
    }
  }

  function stop(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    isDraggingRef.current = false;
    setIsResizing(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSplitPercent((value) => clamp(value - 2));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setSplitPercent((value) => clamp(value + 2));
    } else if (event.key === "Home") {
      event.preventDefault();
      setSplitPercent(MIN_SPLIT_PERCENT);
    } else if (event.key === "End") {
      event.preventDefault();
      setSplitPercent(MAX_SPLIT_PERCENT);
    }
  }

  return {
    splitPercent,
    isResizing,
    onPointerDown,
    onPointerMove,
    onPointerUp: stop,
    onPointerCancel: stop,
    onKeyDown,
  };
}

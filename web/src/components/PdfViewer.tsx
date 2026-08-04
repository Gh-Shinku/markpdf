import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

type PdfViewerProps = {
  source: string;
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "ready" }
  | { kind: "error"; message: string };

const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
const SCALE_STEP = 0.2;
const PDFJS_RESOURCE_BASE = "/pdfjs";

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export function PdfViewer({ source }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1);
  const [fitWidthToken, setFitWidthToken] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "idle" });

  useEffect(() => {
    const host = viewportRef.current;
    if (!host) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setViewportWidth(width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!source) {
      setDocument(null);
      setLoadState({ kind: "idle" });
      return;
    }

    let cancelled = false;
    setLoadState({ kind: "loading", message: "Loading PDF" });
    setDocument(null);
    setPageNumber(1);
    setPageInput("1");

    const loadingTask = pdfjsLib.getDocument({
      url: source,
      cMapPacked: true,
      cMapUrl: `${PDFJS_RESOURCE_BASE}/cmaps/`,
      standardFontDataUrl: `${PDFJS_RESOURCE_BASE}/standard_fonts/`,
      wasmUrl: `${PDFJS_RESOURCE_BASE}/wasm/`,
    });
    loadingTask.promise
      .then((pdf) => {
        if (cancelled) {
          pageCleanupDocument(pdf);
          return;
        }
        setDocument(pdf);
        setLoadState({ kind: "ready" });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setLoadState({
          kind: "error",
          message: error instanceof Error ? error.message : "Failed to load PDF"
        });
      });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      void loadingTask.destroy();
    };
  }, [source]);

  useEffect(() => {
    setPageInput(String(pageNumber));
  }, [pageNumber]);

  useEffect(() => {
    if (!document || !canvasRef.current) {
      return;
    }

    let cancelled = false;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) {
      setLoadState({ kind: "error", message: "Canvas rendering is unavailable" });
      return;
    }

    setLoadState({ kind: "loading", message: `Rendering page ${pageNumber}` });
    renderTaskRef.current?.cancel();

    document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) {
          page.cleanup();
          return;
        }
        return renderPageToCanvas(page, canvas, context, scale);
      })
      .then(() => {
        if (cancelled) {
          return;
        }
        setLoadState({ kind: "ready" });
      })
      .catch((error: unknown) => {
        if (cancelled || isPdfRenderCancellation(error)) {
          return;
        }
        setLoadState({
          kind: "error",
          message: error instanceof Error ? error.message : "Failed to render PDF page"
        });
      });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [document, pageNumber, scale]);

  useEffect(() => {
    if (!document || !viewportWidth || fitWidthToken === 0) {
      return;
    }

    let cancelled = false;
    document.getPage(pageNumber).then((page) => {
      if (cancelled) {
        page.cleanup();
        return;
      }
      const viewport = page.getViewport({ scale: 1 });
      const nextScale = clampScale((viewportWidth - 36) / viewport.width);
      page.cleanup();
      setScale(nextScale);
    });

    return () => {
      cancelled = true;
    };
  }, [document, fitWidthToken, pageNumber, viewportWidth]);

  async function renderPageToCanvas(
    page: PDFPageProxy,
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    nextScale: number,
  ) {
    const viewport = page.getViewport({ scale: nextScale });
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * pixelRatio);
    canvas.height = Math.floor(viewport.height * pixelRatio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);

    const task = page.render({ canvas, canvasContext: context, viewport });
    renderTaskRef.current = task;
    await task.promise;
    if (renderTaskRef.current === task) {
      renderTaskRef.current = null;
    }
    page.cleanup();
  }

  function previousPage() {
    setPageNumber((value) => Math.max(1, value - 1));
  }

  function nextPage() {
    setPageNumber((value) => Math.min(document?.numPages ?? 1, value + 1));
  }

  function commitPageInput() {
    const nextPageValue = Number.parseInt(pageInput, 10);
    if (!Number.isInteger(nextPageValue) || !document) {
      setPageInput(String(pageNumber));
      return;
    }
    const clampedPage = Math.min(document.numPages, Math.max(1, nextPageValue));
    setPageNumber(clampedPage);
    setPageInput(String(clampedPage));
  }

  function zoomOut() {
    setScale((value) => clampScale(value - SCALE_STEP));
  }

  function zoomIn() {
    setScale((value) => clampScale(value + SCALE_STEP));
  }

  function resetZoom() {
    setScale(1);
  }

  function fitWidth() {
    setFitWidthToken((value) => value + 1);
  }

  const pageCount = document?.numPages ?? 0;
  const isReady = Boolean(document);

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-toolbar">
        <button className="secondary-action icon-only" type="button" disabled={!isReady || pageNumber <= 1} onClick={previousPage}>
          <ChevronLeft size={16} />
        </button>
        <label className="pdf-page-control">
          <input
            value={pageInput}
            disabled={!isReady}
            onBlur={commitPageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitPageInput();
              }
            }}
          />
          <span>/ {pageCount || "-"}</span>
        </label>
        <button className="secondary-action icon-only" type="button" disabled={!isReady || pageNumber >= pageCount} onClick={nextPage}>
          <ChevronRight size={16} />
        </button>
        <span className="pdf-toolbar-separator" />
        <button className="secondary-action icon-only" type="button" disabled={!isReady} onClick={zoomOut}>
          <Minus size={16} />
        </button>
        <span className="pdf-zoom-label">{Math.round(scale * 100)}%</span>
        <button className="secondary-action icon-only" type="button" disabled={!isReady} onClick={zoomIn}>
          <Plus size={16} />
        </button>
        <button className="secondary-action icon-only" type="button" disabled={!isReady} onClick={resetZoom}>
          <RotateCcw size={16} />
        </button>
        <button className="secondary-action" type="button" disabled={!isReady} onClick={fitWidth}>
          <Maximize2 size={16} />
          Fit
        </button>
      </div>

      <div className="pdf-viewer-stage" ref={viewportRef}>
        {loadState.kind === "idle" ? (
          <div className="pdf-viewer-message">No PDF loaded.</div>
        ) : null}
        {loadState.kind === "error" ? (
          <div className="pdf-viewer-message error">{loadState.message}</div>
        ) : null}
        {loadState.kind === "loading" ? (
          <div className="pdf-viewer-message">{loadState.message}</div>
        ) : null}
        <canvas className="pdf-page-canvas" ref={canvasRef} />
      </div>
    </div>
  );
}

function isPdfRenderCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

function pageCleanupDocument(document: PDFDocumentProxy): void {
  document.cleanup();
}

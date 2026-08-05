import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Image,
  ListTree,
  Maximize2,
  Minus,
  Plus,
  RotateCcw
} from "lucide-react";
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

type PageSize = {
  width: number;
  height: number;
};

type SidebarTab = "thumbnails" | "outline";

type PdfOutlineItem = {
  title?: string;
  dest?: string | unknown[] | null;
  items?: PdfOutlineItem[];
};

const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
const SCALE_STEP = 0.2;
const PDFJS_RESOURCE_BASE = "/pdfjs";
const FALLBACK_PAGE_SIZE: PageSize = { width: 612, height: 792 };

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export function PdfViewer({ source }: PdfViewerProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sidebarBodyRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const scrollFrameRef = useRef<number | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [stageWidth, setStageWidth] = useState(0);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("thumbnails");
  const [loadState, setLoadState] = useState<LoadState>({ kind: "idle" });

  useEffect(() => {
    const host = stageRef.current;
    if (!host) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setStageWidth(width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!source) {
      setPdfDocument(null);
      setPageSizes([]);
      setOutline([]);
      setLoadState({ kind: "idle" });
      return;
    }

    let cancelled = false;
    setLoadState({ kind: "loading", message: "Loading PDF" });
    setPdfDocument(null);
    setPageSizes([]);
    setOutline([]);
    setPageNumber(1);
    setPageInput("1");
    setFitMode(true);

    const loadingTask = pdfjsLib.getDocument({
      url: source,
      cMapPacked: true,
      cMapUrl: `${PDFJS_RESOURCE_BASE}/cmaps/`,
      standardFontDataUrl: `${PDFJS_RESOURCE_BASE}/standard_fonts/`,
      wasmUrl: `${PDFJS_RESOURCE_BASE}/wasm/`,
    });

    loadingTask.promise
      .then(async (pdf) => {
        if (cancelled) {
          pageCleanupDocument(pdf);
          return;
        }

        setPdfDocument(pdf);
        setLoadState({ kind: "loading", message: "Reading page metadata" });

        const [nextSizes, nextOutline] = await Promise.all([
          loadPageSizes(pdf, () => cancelled),
          pdf.getOutline().then((items) => (items ?? []) as PdfOutlineItem[]),
        ]);

        if (cancelled) {
          pageCleanupDocument(pdf);
          return;
        }

        setPageSizes(nextSizes);
        setOutline(nextOutline);
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
      void loadingTask.destroy();
    };
  }, [source]);

  useEffect(() => {
    setPageInput(String(pageNumber));
  }, [pageNumber]);

  useEffect(() => {
    if (!fitMode || !stageWidth || pageSizes.length === 0) {
      return;
    }

    const firstPageWidth = pageSizes[0]?.width ?? FALLBACK_PAGE_SIZE.width;
    const availableWidth = Math.max(240, stageWidth - 40);
    setScale(clampScale(availableWidth / firstPageWidth));
  }, [fitMode, pageSizes, stageWidth]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  function setPageNode(page: number, node: HTMLDivElement | null) {
    pageRefs.current[page - 1] = node;
  }

  function scrollToPage(nextPage: number) {
    const pageCount = pdfDocument?.numPages ?? 0;
    if (!pageCount) {
      return;
    }
    const clampedPage = Math.min(pageCount, Math.max(1, nextPage));
    pageRefs.current[clampedPage - 1]?.scrollIntoView({ block: "start", behavior: "smooth" });
    setPageNumber(clampedPage);
  }

  function updateCurrentPageFromScroll() {
    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const stage = stageRef.current;
      if (!stage) {
        return;
      }

      const stageRect = stage.getBoundingClientRect();
      const anchor = stageRect.top + 18;
      let bestPage = pageNumber;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let index = 0; index < pageRefs.current.length; index += 1) {
        const node = pageRefs.current[index];
        if (!node) {
          continue;
        }
        const rect = node.getBoundingClientRect();
        if (rect.bottom < stageRect.top || rect.top > stageRect.bottom) {
          continue;
        }
        const distance = Math.abs(rect.top - anchor);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPage = index + 1;
        }
      }

      if (bestPage !== pageNumber) {
        setPageNumber(bestPage);
      }
    });
  }

  function previousPage() {
    scrollToPage(pageNumber - 1);
  }

  function nextPage() {
    scrollToPage(pageNumber + 1);
  }

  function commitPageInput() {
    const nextPageValue = Number.parseInt(pageInput, 10);
    if (!Number.isInteger(nextPageValue) || !pdfDocument) {
      setPageInput(String(pageNumber));
      return;
    }
    scrollToPage(nextPageValue);
  }

  function zoomOut() {
    setFitMode(false);
    setScale((value) => clampScale(value - SCALE_STEP));
  }

  function zoomIn() {
    setFitMode(false);
    setScale((value) => clampScale(value + SCALE_STEP));
  }

  function resetZoom() {
    setFitMode(false);
    setScale(1);
  }

  function fitWidth() {
    setFitMode(true);
  }

  async function jumpToOutlineItem(item: PdfOutlineItem) {
    if (!pdfDocument) {
      return;
    }
    const targetPage = await resolveOutlinePage(pdfDocument, item);
    if (targetPage !== null) {
      scrollToPage(targetPage);
    }
  }

  const pageCount = pdfDocument?.numPages ?? 0;
  const isReady = Boolean(pdfDocument);
  const pages = useMemo(() => Array.from({ length: pageCount }, (_, index) => index + 1), [pageCount]);

  return (
    <div className="pdf-viewer">
      <aside className="pdf-sidebar" aria-label="PDF sidebar">
        <div className="pdf-sidebar-tabs" role="tablist" aria-label="PDF sidebar sections">
          <button
            className={`pdf-sidebar-tab${sidebarTab === "thumbnails" ? " active" : ""}`}
            type="button"
            role="tab"
            aria-selected={sidebarTab === "thumbnails"}
            onClick={() => setSidebarTab("thumbnails")}
          >
            <Image size={15} />
            Pages
          </button>
          <button
            className={`pdf-sidebar-tab${sidebarTab === "outline" ? " active" : ""}`}
            type="button"
            role="tab"
            aria-selected={sidebarTab === "outline"}
            onClick={() => setSidebarTab("outline")}
          >
            <ListTree size={15} />
            Outline
          </button>
        </div>

        <div className="pdf-sidebar-body" ref={sidebarBodyRef}>
          {sidebarTab === "thumbnails" ? (
            <div className="pdf-thumbnail-list">
              {pages.map((page) => (
                <button
                  className={`pdf-thumbnail-row${page === pageNumber ? " active" : ""}`}
                  key={page}
                  type="button"
                  onClick={() => scrollToPage(page)}
                >
                  {pdfDocument ? (
                    <ThumbnailCanvas
                      document={pdfDocument}
                      pageNumber={page}
                      rootRef={sidebarBodyRef}
                      size={pageSizes[page - 1] ?? pageSizes[0] ?? FALLBACK_PAGE_SIZE}
                    />
                  ) : null}
                  <span>{page}</span>
                </button>
              ))}
            </div>
          ) : (
            <OutlineTree items={outline} level={0} onSelect={jumpToOutlineItem} />
          )}
        </div>
      </aside>

      <section className="pdf-main" aria-label="PDF document">
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

        <div className="pdf-viewer-stage" ref={stageRef} onScroll={updateCurrentPageFromScroll}>
          {loadState.kind === "idle" ? (
            <div className="pdf-viewer-message">No PDF loaded.</div>
          ) : null}
          {loadState.kind === "error" ? (
            <div className="pdf-viewer-message error">{loadState.message}</div>
          ) : null}
          {loadState.kind === "loading" ? (
            <div className="pdf-viewer-message">{loadState.message}</div>
          ) : null}
          <div className="pdf-page-list">
            {pages.map((page) => (
              <PdfPageCanvas
                document={pdfDocument}
                isCurrent={page === pageNumber}
                key={page}
                onPageNode={setPageNode}
                pageNumber={page}
                rootRef={stageRef}
                scale={scale}
                size={pageSizes[page - 1] ?? pageSizes[0] ?? FALLBACK_PAGE_SIZE}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

type PdfPageCanvasProps = {
  document: PDFDocumentProxy | null;
  isCurrent: boolean;
  onPageNode: (pageNumber: number, node: HTMLDivElement | null) => void;
  pageNumber: number;
  rootRef: RefObject<HTMLDivElement | null>;
  scale: number;
  size: PageSize;
};

function PdfPageCanvas({
  document,
  isCurrent,
  onPageNode,
  pageNumber,
  rootRef,
  scale,
  size
}: PdfPageCanvasProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const cssWidth = Math.floor(size.width * scale);
  const cssHeight = Math.floor(size.height * scale);

  useEffect(() => {
    const root = rootRef.current;
    const node = shellRef.current;
    if (!root || !node) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsNearViewport(Boolean(entry?.isIntersecting)),
      { root, rootMargin: "900px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootRef]);

  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!document || !isNearViewport || !canvasRef.current) {
      return;
    }

    let cancelled = false;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    renderTaskRef.current?.cancel();
    document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) {
          page.cleanup();
          return undefined;
        }
        return renderPageToCanvas(page, canvas, context, scale);
      })
      .then((task) => {
        if (!task) {
          return;
        }
        renderTaskRef.current = task;
        return task.promise.finally(() => {
          if (renderTaskRef.current === task) {
            renderTaskRef.current = null;
          }
        });
      })
      .catch((error: unknown) => {
        if (!cancelled && !isPdfRenderCancellation(error)) {
          console.error(error);
        }
      });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [document, isNearViewport, pageNumber, scale]);

  return (
    <div
      className={`pdf-page-shell${isCurrent ? " current" : ""}`}
      ref={(node) => {
        shellRef.current = node;
        onPageNode(pageNumber, node);
      }}
      style={{ width: cssWidth, height: cssHeight }}
    >
      <canvas
        aria-label={`Page ${pageNumber}`}
        className="pdf-page-canvas"
        ref={canvasRef}
        style={{ width: cssWidth, height: cssHeight }}
      />
      {!isNearViewport ? <div className="pdf-page-placeholder">Page {pageNumber}</div> : null}
    </div>
  );
}

type ThumbnailCanvasProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  rootRef: RefObject<HTMLDivElement | null>;
  size: PageSize;
};

function ThumbnailCanvas({ document, pageNumber, rootRef, size }: ThumbnailCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const thumbWidth = 92;
  const thumbScale = thumbWidth / size.width;
  const thumbHeight = Math.floor(size.height * thumbScale);

  useEffect(() => {
    const root = rootRef.current;
    const node = rowRef.current;
    if (!root || !node) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsNearViewport(Boolean(entry?.isIntersecting)),
      { root, rootMargin: "500px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootRef]);

  useEffect(() => {
    if (!isNearViewport || !canvasRef.current) {
      return;
    }

    let cancelled = false;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    renderTaskRef.current?.cancel();
    document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) {
          page.cleanup();
          return undefined;
        }
        return renderPageToCanvas(page, canvas, context, thumbScale);
      })
      .then((task) => {
        if (!task) {
          return;
        }
        renderTaskRef.current = task;
        return task.promise.finally(() => {
          if (renderTaskRef.current === task) {
            renderTaskRef.current = null;
          }
        });
      })
      .catch((error: unknown) => {
        if (!cancelled && !isPdfRenderCancellation(error)) {
          console.error(error);
        }
      });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [document, isNearViewport, pageNumber, thumbScale]);

  return (
    <div className="pdf-thumbnail-canvas-wrap" ref={rowRef} style={{ width: thumbWidth, height: thumbHeight }}>
      <canvas
        aria-label={`Page ${pageNumber} thumbnail`}
        className="pdf-thumbnail-canvas"
        ref={canvasRef}
        style={{ width: thumbWidth, height: thumbHeight }}
      />
    </div>
  );
}

type OutlineTreeProps = {
  items: PdfOutlineItem[];
  level: number;
  onSelect: (item: PdfOutlineItem) => void;
};

function OutlineTree({ items, level, onSelect }: OutlineTreeProps) {
  if (items.length === 0 && level === 0) {
    return (
      <div className="pdf-outline-empty">
        <FileText size={18} />
        <span>No embedded outline.</span>
      </div>
    );
  }

  return (
    <div className="pdf-outline-tree">
      {items.map((item, index) => (
        <div className="pdf-outline-node" key={`${level}-${index}-${item.title ?? "untitled"}`}>
          <button
            className="pdf-outline-button"
            style={{ paddingLeft: 8 + level * 14 }}
            type="button"
            onClick={() => onSelect(item)}
          >
            {item.title || "Untitled"}
          </button>
          {item.items && item.items.length > 0 ? (
            <OutlineTree items={item.items} level={level + 1} onSelect={onSelect} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  scale: number,
): RenderTask {
  const viewport = page.getViewport({ scale });
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, viewport.width, viewport.height);

  const task = page.render({ canvas, canvasContext: context, viewport });
  void task.promise.finally(() => page.cleanup()).catch(() => undefined);
  return task;
}

async function loadPageSizes(
  document: PDFDocumentProxy,
  isCancelled: () => boolean,
): Promise<PageSize[]> {
  const sizes: PageSize[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (isCancelled()) {
      return sizes;
    }
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    sizes.push({ width: viewport.width, height: viewport.height });
    page.cleanup();
  }
  return sizes;
}

async function resolveOutlinePage(
  document: PDFDocumentProxy,
  item: PdfOutlineItem,
): Promise<number | null> {
  if (!item.dest) {
    return null;
  }

  const destination = typeof item.dest === "string"
    ? await document.getDestination(item.dest)
    : item.dest;
  const pageRef = Array.isArray(destination) ? destination[0] : null;
  if (!pageRef || typeof pageRef === "number") {
    return typeof pageRef === "number" ? pageRef + 1 : null;
  }

  const pageIndex = await document.getPageIndex(pageRef as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
  return pageIndex + 1;
}

function isPdfRenderCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

function pageCleanupDocument(document: PDFDocumentProxy): void {
  document.cleanup();
}

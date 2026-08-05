import { useEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  toolbarStart?: ReactNode;
  toolbarControlsExtra?: ReactNode;
  toolbarEnd?: ReactNode;
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
const PAGE_GAP = 14;
const PAGE_VERTICAL_PADDING = 18;
const PAGE_HORIZONTAL_PADDING = 18;
const THUMBNAIL_WIDTH = 92;
const THUMBNAIL_ROW_GAP = 7;
const THUMBNAIL_ROW_CHROME = 38;
const MAIN_MAX_PIXEL_RATIO = 2;
const THUMBNAIL_PIXEL_RATIO = 1;
const PDFJS_RESOURCE_BASE = "/pdfjs";
const FALLBACK_PAGE_SIZE: PageSize = { width: 612, height: 792 };

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export function PdfViewer({
  source,
  toolbarStart,
  toolbarControlsExtra,
  toolbarEnd
}: PdfViewerProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sidebarBodyRef = useRef<HTMLDivElement | null>(null);
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "idle" });

  const pageCount = pdfDocument?.numPages ?? 0;
  const isReady = Boolean(pdfDocument);

  const pageVirtualizer = useVirtualizer({
    count: pageCount,
    getScrollElement: () => stageRef.current,
    estimateSize: (index) => getPageCssHeight(pageSizes[index], scale) + PAGE_GAP,
    overscan: 3,
    paddingStart: PAGE_VERTICAL_PADDING,
    paddingEnd: PAGE_VERTICAL_PADDING,
  });

  const thumbnailVirtualizer = useVirtualizer({
    count: pageCount,
    enabled: isSidebarOpen && sidebarTab === "thumbnails",
    getScrollElement: () => sidebarBodyRef.current,
    estimateSize: (index) => getThumbnailRowHeight(pageSizes[index]) + THUMBNAIL_ROW_GAP,
    overscan: 6,
  });

  const virtualPages = pageVirtualizer.getVirtualItems();
  const virtualThumbnails = thumbnailVirtualizer.getVirtualItems();
  const pageListWidth = Math.max(
    stageWidth,
    Math.floor(getMaxPageWidth(pageSizes) * scale) + PAGE_HORIZONTAL_PADDING * 2,
  );

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
    let loadedDocument: PDFDocumentProxy | null = null;
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
        loadedDocument = pdf;
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
      if (loadedDocument) {
        pageCleanupDocument(loadedDocument);
      }
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
    const availableWidth = Math.max(240, stageWidth - PAGE_HORIZONTAL_PADDING * 2);
    setScale(clampScale(availableWidth / firstPageWidth));
  }, [fitMode, pageSizes, stageWidth]);

  useEffect(() => {
    pageVirtualizer.measure();
  }, [pageVirtualizer, pageSizes, scale]);

  useEffect(() => {
    thumbnailVirtualizer.measure();
  }, [thumbnailVirtualizer, pageSizes, isSidebarOpen, sidebarTab]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  function scrollToPage(nextPage: number) {
    if (!pageCount) {
      return;
    }
    const clampedPage = Math.min(pageCount, Math.max(1, nextPage));
    pageVirtualizer.scrollToIndex(clampedPage - 1, { align: "start", behavior: "smooth" });
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

      const anchor = stage.scrollTop + PAGE_VERTICAL_PADDING;
      const visiblePages = pageVirtualizer.getVirtualItems();
      let bestPage = pageNumber;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const item of visiblePages) {
        const distance = Math.abs(item.start - anchor);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPage = item.index + 1;
        }
      }

      setPageNumber((current) => (bestPage === current ? current : bestPage));
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

  function toggleSidebar() {
    setIsSidebarOpen((value) => !value);
    setFitMode(true);
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

  return (
    <div className={`pdf-viewer${isSidebarOpen ? "" : " sidebar-collapsed"}`}>
      <button
        className="pdf-sidebar-toggle"
        type="button"
        aria-label={isSidebarOpen ? "Hide PDF sidebar" : "Show PDF sidebar"}
        onClick={toggleSidebar}
      >
        <span className="pdf-sidebar-toggle-surface">
          {isSidebarOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      <aside className={`pdf-sidebar${isSidebarOpen ? "" : " collapsed"}`} aria-label="PDF sidebar">
        {isSidebarOpen ? (
          <>
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
                <div className="pdf-thumbnail-list" style={{ height: thumbnailVirtualizer.getTotalSize() }}>
                  {virtualThumbnails.map((item) => {
                    const page = item.index + 1;
                    return (
                      <button
                        className={`pdf-thumbnail-row${page === pageNumber ? " active" : ""}`}
                        data-index={item.index}
                        key={item.key}
                        ref={thumbnailVirtualizer.measureElement}
                        style={{ transform: `translateY(${item.start}px)` }}
                        type="button"
                        onClick={() => scrollToPage(page)}
                      >
                        {pdfDocument ? (
                          <ThumbnailCanvas
                            document={pdfDocument}
                            pageNumber={page}
                            size={pageSizes[item.index] ?? pageSizes[0] ?? FALLBACK_PAGE_SIZE}
                          />
                        ) : null}
                        <span>{page}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <OutlineTree items={outline} level={0} onSelect={jumpToOutlineItem} />
              )}
            </div>
          </>
        ) : null}
      </aside>

      <section className="pdf-main" aria-label="PDF document">
        <div className={`pdf-viewer-toolbar${toolbarStart || toolbarEnd ? " with-meta" : ""}`}>
          {toolbarStart ? <div className="pdf-toolbar-leading">{toolbarStart}</div> : null}
          <div className="pdf-toolbar-controls">
            {toolbarControlsExtra}
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
          {toolbarEnd ? <div className="pdf-toolbar-trailing">{toolbarEnd}</div> : null}
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
          <div
            className="pdf-page-list"
            style={{ height: pageVirtualizer.getTotalSize(), width: pageListWidth }}
          >
            {virtualPages.map((item) => {
              const page = item.index + 1;
              const size = pageSizes[item.index] ?? pageSizes[0] ?? FALLBACK_PAGE_SIZE;
              const cssWidth = getPageCssWidth(size, scale);
              const cssHeight = getPageCssHeight(size, scale);
              return (
                <div
                  className="pdf-page-virtual-row"
                  data-index={item.index}
                  key={item.key}
                  ref={pageVirtualizer.measureElement}
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  <PdfPageCanvas
                    document={pdfDocument}
                    isCurrent={page === pageNumber}
                    pageNumber={page}
                    scale={scale}
                    width={cssWidth}
                    height={cssHeight}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

type PdfPageCanvasProps = {
  document: PDFDocumentProxy | null;
  isCurrent: boolean;
  pageNumber: number;
  scale: number;
  width: number;
  height: number;
};

function PdfPageCanvas({
  document,
  isCurrent,
  pageNumber,
  scale,
  width,
  height
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      releaseCanvas(canvasRef.current);
    };
  }, []);

  useEffect(() => {
    if (!document || !canvasRef.current) {
      releaseCanvas(canvasRef.current);
      return;
    }

    let cancelled = false;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    renderTaskRef.current?.cancel();
    releaseCanvas(canvas);
    document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) {
          page.cleanup();
          return undefined;
        }
        const task = renderPageToCanvas(page, canvas, context, scale, MAIN_MAX_PIXEL_RATIO);
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
      releaseCanvas(canvas);
    };
  }, [document, pageNumber, scale]);

  return (
    <div
      className={`pdf-page-shell${isCurrent ? " current" : ""}`}
      style={{ width, height }}
    >
      <canvas
        aria-label={`Page ${pageNumber}`}
        className="pdf-page-canvas"
        ref={canvasRef}
        style={{ width, height }}
      />
    </div>
  );
}

type ThumbnailCanvasProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  size: PageSize;
};

function ThumbnailCanvas({ document, pageNumber, size }: ThumbnailCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const thumbScale = THUMBNAIL_WIDTH / size.width;
  const thumbHeight = getThumbnailHeight(size);

  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      releaseCanvas(canvasRef.current);
    };
  }, []);

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    let cancelled = false;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    renderTaskRef.current?.cancel();
    releaseCanvas(canvas);
    document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) {
          page.cleanup();
          return undefined;
        }
        const task = renderPageToCanvas(page, canvas, context, thumbScale, THUMBNAIL_PIXEL_RATIO);
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
      releaseCanvas(canvas);
    };
  }, [document, pageNumber, thumbScale]);

  return (
    <div className="pdf-thumbnail-canvas-wrap" style={{ width: THUMBNAIL_WIDTH, height: thumbHeight }}>
      <canvas
        aria-label={`Page ${pageNumber} thumbnail`}
        className="pdf-thumbnail-canvas"
        ref={canvasRef}
        style={{ width: THUMBNAIL_WIDTH, height: thumbHeight }}
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
  maxPixelRatio: number,
): RenderTask {
  const viewport = page.getViewport({ scale });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
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

function getPageCssWidth(size: PageSize | undefined, scale: number): number {
  return Math.floor((size ?? FALLBACK_PAGE_SIZE).width * scale);
}

function getPageCssHeight(size: PageSize | undefined, scale: number): number {
  return Math.floor((size ?? FALLBACK_PAGE_SIZE).height * scale);
}

function getMaxPageWidth(pageSizes: PageSize[]): number {
  if (pageSizes.length === 0) {
    return FALLBACK_PAGE_SIZE.width;
  }
  return Math.max(...pageSizes.map((size) => size.width));
}

function getThumbnailHeight(size: PageSize | undefined): number {
  const pageSize = size ?? FALLBACK_PAGE_SIZE;
  return Math.floor(pageSize.height * (THUMBNAIL_WIDTH / pageSize.width));
}

function getThumbnailRowHeight(size: PageSize | undefined): number {
  return getThumbnailHeight(size) + THUMBNAIL_ROW_CHROME;
}

function releaseCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) {
    return;
  }
  canvas.width = 0;
  canvas.height = 0;
}

function isPdfRenderCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

function pageCleanupDocument(document: PDFDocumentProxy): void {
  void document.cleanup();
}

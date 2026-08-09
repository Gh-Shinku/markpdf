import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AppNavigation } from "./AppNavigation";
import usageMd from "../../../docs/USAGE.md?raw";

type DocsViewProps = {
  onOpenHome: () => void;
  onOpenTasks: () => void;
  onOpenPlayground: () => void;
  onOpenSettings: () => void;
};

type DocHeading = { level: 2 | 3; id: string; text: string };

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function flattenText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return flattenText(props?.children);
  }
  return "";
}

const HEADING_RE = /^(#{2,3})\s+(.+)$/gm;

export function DocsView({
  onOpenHome,
  onOpenTasks,
  onOpenPlayground,
  onOpenSettings,
}: DocsViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);

  const headings = useMemo<DocHeading[]>(() => {
    const items: DocHeading[] = [];
    for (const match of usageMd.matchAll(HEADING_RE)) {
      const text = match[2].trim();
      items.push({
        level: match[1].length === 2 ? 2 : 3,
        id: slugify(text),
        text,
      });
    }
    return items;
  }, []);

  // Keep component overrides and plugins stable so re-renders (e.g. from
  // scroll-spy state updates) do not rebuild the whole markdown tree.
  const markdownComponents = useMemo(
    () => ({
      h1: ({ children }: { children?: React.ReactNode }) => (
        <h1 className="doc-title">{children}</h1>
      ),
      h2: ({ children }: { children?: React.ReactNode }) => (
        <h2 id={slugify(flattenText(children))} className="doc-h2">
          {children}
        </h2>
      ),
      h3: ({ children }: { children?: React.ReactNode }) => (
        <h3 id={slugify(flattenText(children))} className="doc-h3">
          {children}
        </h3>
      ),
      a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      ),
      pre: ({ children }: { children?: React.ReactNode }) => (
        <pre className="doc-pre">{children}</pre>
      ),
      code: ({ className, children }: { className?: string; children?: React.ReactNode }) =>
        typeof className === "string" && className.includes("language-") ? (
          <code className={className}>{children}</code>
        ) : (
          <code className="doc-code-inline">{children}</code>
        ),
    }),
    [],
  );
  const remarkPlugins = useMemo(() => [remarkGfm], []);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;

    // Re-resolve heading nodes on every update: re-renders triggered by
    // setActiveId can rebuild the react-markdown tree, detaching nodes that
    // an effect closure captured. Scroll events are synchronous, so reading
    // the layout here is always fresh.
    const updateActive = () => {
      const articleTop = article.getBoundingClientRect().top;
      let currentId = headings[0]?.id ?? null;
      for (const { id } of headings) {
        const target = article.querySelector<HTMLElement>(`#${id}`);
        if (!target) continue;
        if (target.getBoundingClientRect().top - articleTop > 48) break;
        currentId = id;
      }
      // A long final section may never scroll its top into the trigger zone;
      // pin the last heading once the reader reaches the bottom.
      if (article.scrollTop + article.clientHeight >= article.scrollHeight - 2) {
        currentId = headings[headings.length - 1]?.id ?? currentId;
      }
      setActiveId(currentId);
    };

    updateActive();
    article.addEventListener("scroll", updateActive, { passive: true });
    return () => article.removeEventListener("scroll", updateActive);
  }, [headings]);

  function jumpTo(id: string) {
    const target = articleRef.current?.querySelector<HTMLElement>(`#${id}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="app-shell docs-shell">
      <AppNavigation
        active="docs"
        onHome={onOpenHome}
        onTasks={onOpenTasks}
        onPlayground={onOpenPlayground}
        onDocs={() => undefined}
        onSettings={onOpenSettings}
      />
      <header className="app-header">
        <div>
          <p className="eyebrow">Documentation</p>
          <h1>User Guide</h1>
        </div>
      </header>
      <div className="docs-layout">
        <aside className="docs-sidebar" aria-label="Documentation sections">
          <p className="docs-nav-title">Sections</p>
          <nav className="docs-nav">
            {headings.map((heading) => (
              <button
                key={heading.id}
                type="button"
                className={`docs-nav-item level-${heading.level}${
                  activeId === heading.id ? " active" : ""
                }`}
                onClick={() => jumpTo(heading.id)}
              >
                {heading.text}
              </button>
            ))}
          </nav>
        </aside>
        <article className="docs-article" ref={articleRef}>
          <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
            {usageMd}
          </ReactMarkdown>
        </article>
      </div>
    </main>
  );
}

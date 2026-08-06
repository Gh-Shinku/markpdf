import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AppNavigation } from "./AppNavigation";
import usageMd from "../../../docs/USAGE.md?raw";

type DocsViewProps = {
  onOpenHome: () => void;
  onOpenTasks: () => void;
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

export function DocsView({ onOpenHome, onOpenTasks, onOpenSettings }: DocsViewProps) {
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

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const targets = headings
      .map(({ id }) => article.querySelector<HTMLElement>(`#${id}`))
      .filter((el): el is HTMLElement => el !== null);
    if (!targets.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const top = visible[0];
        if (top) setActiveId(top.target.id);
      },
      { root: article, rootMargin: "-10% 0px -75% 0px" },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
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
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="doc-title">{children}</h1>,
              h2: ({ children }) => (
                <h2 id={slugify(flattenText(children))} className="doc-h2">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 id={slugify(flattenText(children))} className="doc-h3">
                  {children}
                </h3>
              ),
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
              pre: ({ children }) => <pre className="doc-pre">{children}</pre>,
              code: ({ className, children }) =>
                typeof className === "string" && className.includes("language-") ? (
                  <code className={className}>{children}</code>
                ) : (
                  <code className="doc-code-inline">{children}</code>
                ),
            }}
          >
            {usageMd}
          </ReactMarkdown>
        </article>
      </div>
    </main>
  );
}

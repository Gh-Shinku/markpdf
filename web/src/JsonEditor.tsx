import { useEffect, useRef } from "react";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting
} from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import { EditorState, Extension } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers
} from "@codemirror/view";

type JsonEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

function makeExtensions(onChange: (value: string) => void): Extension[] {
  return [
    lineNumbers(),
    foldGutter(),
    lintGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    json(),
    linter(jsonParseLinter()),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString());
      }
    }),
    EditorView.theme({
      "&": {
        height: "100%",
        color: "#1f2a35",
        backgroundColor: "#fbfcfe",
        fontSize: "13px"
      },
      ".cm-scroller": {
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
        lineHeight: "1.55"
      },
      ".cm-content": {
        padding: "14px 0",
        caretColor: "#2266a5"
      },
      ".cm-line": {
        padding: "0 16px 0 8px"
      },
      ".cm-gutters": {
        backgroundColor: "#f3f6f9",
        color: "#697685",
        borderRight: "1px solid #dbe3eb"
      },
      ".cm-activeLine": {
        backgroundColor: "#edf6ff"
      },
      ".cm-activeLineGutter": {
        backgroundColor: "#e3f0fc",
        color: "#174d7e"
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "#b7d7f2"
      },
      "&.cm-focused": {
        outline: "none"
      },
      ".cm-tooltip": {
        border: "1px solid #c6d2df",
        borderRadius: "6px"
      },
      ".cm-diagnostic": {
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      }
    })
  ];
}

export function JsonEditor({ value, onChange }: JsonEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: makeExtensions((nextValue) => onChangeRef.current(nextValue))
      })
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (value === currentValue) {
      return;
    }

    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: value
      }
    });
  }, [value]);

  return <div className="json-editor-shell" ref={hostRef} />;
}

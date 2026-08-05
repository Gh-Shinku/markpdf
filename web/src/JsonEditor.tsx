import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/base/browser/ui/codicons/codiconStyles";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding";
import "monaco-editor/esm/vs/language/json/monaco.contribution";

type JsonEditorProps = {
  value: string;
  theme: "light" | "dark";
  onChange: (value: string) => void;
};

export type JsonEditorHandle = {
  openFind: () => void;
};

const TOC_SCHEMA_URI = "inmemory://bookmark/toc.schema.json";
const MODEL_URI = "inmemory://bookmark/toc.json";

type JsonLanguageDefaults = {
  setDiagnosticsOptions: (options: {
    validate: boolean;
    allowComments: boolean;
    trailingCommas: "ignore" | "warning" | "error";
    schemas: unknown[];
  }) => void;
};

(
  monaco.languages.json as unknown as { jsonDefaults: JsonLanguageDefaults }
).jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: false,
  trailingCommas: "error",
  schemas: [
    {
      uri: TOC_SCHEMA_URI,
      fileMatch: [MODEL_URI],
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "TOC JSON",
        type: "array",
        items: { $ref: "#/definitions/tocNode" },
        definitions: {
          tocNode: {
            type: "object",
            additionalProperties: false,
            required: ["title", "page", "children"],
            properties: {
              title: {
                type: "string",
                minLength: 1,
              },
              page: {
                anyOf: [
                  {
                    type: "integer",
                    minimum: 1,
                  },
                  {
                    type: "null",
                  },
                ],
              },
              attribute: {
                type: "string",
                enum: ["relative", "absolute"],
                default: "relative",
              },
              children: {
                type: "array",
                items: { $ref: "#/definitions/tocNode" },
              },
            },
          },
        },
      },
    },
  ],
});

function createModel(value: string): monaco.editor.ITextModel {
  const uri = monaco.Uri.parse(MODEL_URI);
  const existingModel = monaco.editor.getModel(uri);
  if (existingModel) {
    existingModel.setValue(value);
    return existingModel;
  }
  return monaco.editor.createModel(value, "json", uri);
}

export const JsonEditor = forwardRef<JsonEditorHandle, JsonEditorProps>(function JsonEditor(
  { value, theme, onChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const initialValueRef = useRef(value);
  const initialThemeRef = useRef(theme);
  const onChangeRef = useRef(onChange);
  const suppressChangeRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useImperativeHandle(ref, () => ({
    openFind() {
      editorRef.current?.focus();
      editorRef.current?.getAction("actions.find")?.run();
    },
  }));

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const model = createModel(initialValueRef.current);
    modelRef.current = model;

    const editor = monaco.editor.create(hostRef.current, {
      model,
      language: "json",
      theme: initialThemeRef.current === "dark" ? "vs-dark" : "vs",
      automaticLayout: true,
      minimap: { enabled: false },
      wordWrap: "on",
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: false,
      formatOnPaste: true,
      formatOnType: true,
      scrollBeyondLastLine: false,
      folding: true,
      foldingHighlight: true,
      foldingStrategy: "auto",
      showFoldingControls: "always",
      lineNumbers: "on",
      renderLineHighlight: "all",
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: true,
        indentation: true,
      },
      padding: {
        top: 12,
        bottom: 12,
      },
      scrollbar: {
        verticalScrollbarSize: 12,
        horizontalScrollbarSize: 12,
      },
    });
    editorRef.current = editor;

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
      editor.getAction("actions.find")?.run();
    });

    const subscription = editor.onDidChangeModelContent(() => {
      if (suppressChangeRef.current) {
        return;
      }
      onChangeRef.current(editor.getValue());
    });

    return () => {
      subscription.dispose();
      editor.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
  }, [theme]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model || value === model.getValue()) {
      return;
    }

    suppressChangeRef.current = true;
    model.setValue(value);
    suppressChangeRef.current = false;
    editor.setScrollTop(0);
  }, [value]);

  return <div className="json-editor-shell" ref={hostRef} />;
});

import { useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, UIEvent } from "react";
import { ChevronDown, ChevronRight, FileCode2, Terminal, Upload } from "lucide-react";

import { EXTENSION_TO_LANGUAGE } from "../config/presets";
import type { LanguageKey } from "../config/presets";

interface EditorPaneProps {
  language: LanguageKey;
  filename: string;
  code: string;
  stdin: string;
  running: boolean;
  onCodeChange: (value: string) => void;
  onStdinChange: (value: string) => void;
  onLanguageDetected: (language: LanguageKey) => void;
  onUploadError: (message: string) => void;
  onRun: () => void;
}

export default function EditorPane({
  language,
  filename,
  code,
  stdin,
  running,
  onCodeChange,
  onStdinChange,
  onLanguageDetected,
  onUploadError,
  onRun,
}: EditorPaneProps) {
  const [stdinOpen, setStdinOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lineCount = code.length === 0 ? 1 : code.split("\n").length;
  const lineNumbers = Array.from({ length: lineCount }, (_, index) => index + 1);
  const byteCount = new TextEncoder().encode(code).length;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!running) {
        onRun();
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const next = `${code.slice(0, start)}    ${code.slice(end)}`;
      onCodeChange(next);
      requestAnimationFrame(() => {
        target.selectionStart = start + 4;
        target.selectionEnd = start + 4;
      });
    }
  };

  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = event.currentTarget.scrollTop;
    }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    const dot = file.name.lastIndexOf(".");
    const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
    const detected = EXTENSION_TO_LANGUAGE[extension];
    if (!detected) {
      onUploadError(`Unsupported file type "${extension || file.name}". Use .cpp, .c, .py or .js.`);
      return;
    }
    try {
      const text = await file.text();
      onLanguageDetected(detected);
      onCodeChange(text);
    } catch {
      onUploadError(`Unable to read ${file.name}.`);
    }
  };

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl border border-stroke bg-panel shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stroke px-4 py-3">
        <div className="flex items-center gap-2">
          <FileCode2 size={16} className="text-accent" />
          <span className="rounded border border-stroke bg-ink/70 px-2 py-1 font-mono text-[11px] font-semibold tracking-wide text-slate-200">
            {filename}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
            {language === "cpp" ? "C++20" : language === "c" ? "C11" : language === "python" ? "Python 3" : "Node.js"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] tracking-[0.12em] text-slate-500">
            {lineCount} LN · {byteCount} B
          </span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stroke bg-ink/60 px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-slate-300 transition hover:border-accent/50 hover:text-accent"
          >
            <Upload size={13} />
            UPLOAD FILE
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".cpp,.c,.py,.js"
            onChange={handleUpload}
            className="hidden"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 bg-[#070b14]">
        <div
          ref={gutterRef}
          className="w-12 shrink-0 select-none overflow-hidden border-r border-stroke/70 bg-[#080d18] py-4 text-right font-mono text-xs leading-6 text-slate-600"
          aria-hidden="true"
        >
          {lineNumbers.map((line) => (
            <div key={line} className="pr-3">
              {line}
            </div>
          ))}
        </div>
        <textarea
          value={code}
          onChange={(event) => onCodeChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          aria-label="Source code editor"
          className="h-[430px] min-w-0 flex-1 resize-none overflow-auto bg-transparent px-4 py-4 font-mono text-xs leading-6 text-slate-200 caret-emerald outline-none sm:h-[480px] xl:h-[520px]"
        />
      </div>

      <div className="border-t border-stroke">
        <button
          type="button"
          onClick={() => setStdinOpen((open) => !open)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left transition hover:bg-ink/40"
        >
          <span className="flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.18em] text-slate-400">
            <Terminal size={13} className="text-slate-500" />
            STDIN
            <span className="rounded bg-ink/80 px-1.5 py-0.5 text-[9px] text-slate-500">
              {new TextEncoder().encode(stdin).length} B
            </span>
          </span>
          {stdinOpen ? (
            <ChevronDown size={14} className="text-slate-500" />
          ) : (
            <ChevronRight size={14} className="text-slate-500" />
          )}
        </button>
        {stdinOpen ? (
          <div className="px-4 pb-4">
            <textarea
              value={stdin}
              onChange={(event) => onStdinChange(event.target.value)}
              spellCheck={false}
              rows={4}
              placeholder="stdin bytes delivered to the sandbox"
              className="w-full resize-y rounded-lg border border-stroke bg-[#070b14] px-3 py-2 font-mono text-xs leading-5 text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-accent/60"
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stroke px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-slate-600">
        <span>TAB = 4 SPACES</span>
        <span>CTRL + ENTER = RUN IN SANDBOX</span>
      </div>
    </section>
  );
}

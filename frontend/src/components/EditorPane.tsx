import { useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, UIEvent } from "react";
import { ChevronDown, ChevronRight, FileCode2, Terminal, Upload } from "lucide-react";

import { EXTENSION_TO_LANGUAGE } from "../config/presets";
import type { LanguageKey } from "../config/presets";
import GtkWindow from "./GtkWindow";

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

const LANGUAGE_LABELS: Record<LanguageKey, string> = {
  cpp: "C++20",
  c: "C11",
  python: "Python 3",
  javascript: "Node.js",
};

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
  const stdinBytes = new TextEncoder().encode(stdin).length;

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
    <GtkWindow
      id="editor"
      title="Source Editor"
      icon={<FileCode2 size={14} />}
      bodyClassName="flex flex-col"
      badges={
        <>
          <span className="gtk-badge gtk-badge--accent">{filename}</span>
          <span className="gtk-badge hidden sm:inline-flex">{LANGUAGE_LABELS[language]}</span>
          <span className="gtk-badge hidden sm:inline-flex">
            {lineCount} LN · {byteCount} B
          </span>
        </>
      }
      actions={
        <>
          <button
            type="button"
            className="gtk-button gtk-button--flat h-7 px-2 text-[11px]"
            onClick={() => fileInputRef.current?.click()}
            title="Upload a .cpp, .c, .py or .js file"
          >
            <Upload size={12} />
            <span className="hidden sm:inline">Upload File</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".cpp,.c,.py,.js"
            onChange={handleUpload}
            className="hidden"
          />
        </>
      }
    >
      <div className="flex h-[430px] min-h-0 bg-white sm:h-[480px] xl:h-[540px]">
        <div ref={gutterRef} className="editor-gutter" aria-hidden="true">
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
          className="editor-textarea h-full"
        />
      </div>

      <div className="border-t border-[#deddda]">
        <button
          type="button"
          onClick={() => setStdinOpen((open) => !open)}
          className="flex w-full items-center justify-between bg-[#f6f5f4] px-3 py-2 text-left hover:bg-[#ededec]"
          aria-expanded={stdinOpen}
        >
          <span className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#5e5c64]">
            <Terminal size={13} />
            Standard Input
            <span className="gtk-badge normal-case tracking-normal">{stdinBytes} B</span>
          </span>
          {stdinOpen ? (
            <ChevronDown size={14} className="text-[#5e5c64]" />
          ) : (
            <ChevronRight size={14} className="text-[#5e5c64]" />
          )}
        </button>
        {stdinOpen ? (
          <div className="border-t border-[#deddda] bg-white p-3">
            <textarea
              value={stdin}
              onChange={(event) => onStdinChange(event.target.value)}
              spellCheck={false}
              rows={4}
              placeholder="stdin bytes delivered to the sandbox"
              className="w-full resize-y rounded border border-[#c0bfbc] bg-[#f6f5f4] px-2.5 py-2 font-mono text-[11px] leading-5 text-charcoal outline-none placeholder:text-[#9a9996] focus:border-[#3584e4]"
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#deddda] bg-[#f6f5f4] px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#77767b]">
        <span>Tab = 4 spaces</span>
        <span>Ctrl + Enter = Run in sandbox</span>
      </div>
    </GtkWindow>
  );
}

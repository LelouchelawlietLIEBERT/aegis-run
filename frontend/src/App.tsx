import { useEffect, useState } from "react";

import EditorPane from "./components/EditorPane";
import HeaderBar from "./components/HeaderBar";
import KernelConfigPane from "./components/KernelConfigPane";
import TelemetryConsole from "./components/TelemetryConsole";
import { env } from "./config/env";
import {
  DEFAULT_LIMITS,
  LANGUAGE_OPTIONS,
  PRESETS,
  STARTER_CODE,
} from "./config/presets";
import type { LanguageKey, SandboxLimits } from "./config/presets";
import {
  SandboxApiError,
  checkHealth,
  executeSandbox,
} from "./services/sandboxApi";
import type { SandboxResult } from "./services/sandboxApi";
import type { ConnectionState } from "./types/ui";

export default function App() {
  const [language, setLanguage] = useState<LanguageKey>("cpp");
  const [code, setCode] = useState<string>(STARTER_CODE.cpp);
  const [stdin, setStdin] = useState<string>("");
  const [limits, setLimits] = useState<SandboxLimits>(DEFAULT_LIMITS);
  const [selectedPreset, setSelectedPreset] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);
  const [result, setResult] = useState<SandboxResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [mode, setMode] = useState<string>("unknown");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const probe = async () => {
      try {
        const health = await checkHealth(controller.signal);
        if (!active) {
          return;
        }
        setConnection("online");
        setMode(health.mode);
      } catch {
        if (active) {
          setConnection("offline");
        }
      }
    };

    probe();
    const timer = window.setInterval(probe, 15000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!env.configured) {
      setError("Frontend environment is incomplete. Set VITE_API_BASE_URL and VITE_API_KEY in frontend/.env.");
    }
  }, []);

  const filename =
    LANGUAGE_OPTIONS.find((option) => option.key === language)?.filename ?? "main.cpp";

  const handleLanguageChange = (next: LanguageKey) => {
    const previousStarter = STARTER_CODE[language];
    if (!code.trim() || code === previousStarter) {
      setCode(STARTER_CODE[next]);
    }
    setLanguage(next);
    setSelectedPreset("");
    setError(null);
  };

  const handleLanguageDetected = (next: LanguageKey) => {
    setLanguage(next);
    setSelectedPreset("");
  };

  const handleCodeChange = (value: string) => {
    setCode(value);
    if (selectedPreset) {
      setSelectedPreset("");
    }
  };

  const handlePresetChange = (presetId: string) => {
    setSelectedPreset(presetId);
    setError(null);
    if (!presetId) {
      return;
    }
    const preset = PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    setLanguage(preset.language);
    setCode(preset.source);
    setStdin(preset.stdin);
    setLimits(preset.limits);
  };

  const handleLimitsChange = (next: SandboxLimits) => {
    setLimits(next);
    if (selectedPreset) {
      setSelectedPreset("");
    }
  };

  const handleRun = async () => {
    if (running) {
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const response = await executeSandbox({
        language,
        sourceCode: code,
        stdin,
        limits,
      });
      setResult(response);
      setMode(response.mode);
      setConnection("online");
    } catch (caught) {
      if (caught instanceof SandboxApiError) {
        setError(caught.message);
        if (caught.status === 401) {
          setConnection("offline");
        }
      } else if (caught instanceof Error) {
        setError(caught.message);
        setConnection("offline");
      } else {
        setError("Unexpected sandbox client failure.");
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid-backdrop min-h-screen text-slate-200">
      <HeaderBar
        language={language}
        onLanguageChange={handleLanguageChange}
        selectedPreset={selectedPreset}
        onPresetChange={handlePresetChange}
        onRun={handleRun}
        running={running}
        connection={connection}
        mode={mode}
      />

      <main className="mx-auto max-w-[1720px] px-4 pb-6 pt-4 sm:px-6">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-5">
            <EditorPane
              language={language}
              filename={filename}
              code={code}
              stdin={stdin}
              running={running}
              onCodeChange={handleCodeChange}
              onStdinChange={setStdin}
              onLanguageDetected={handleLanguageDetected}
              onUploadError={(message) => setError(message)}
              onRun={handleRun}
            />
          </div>

          <div className="flex flex-col gap-4 xl:col-span-7">
            <KernelConfigPane limits={limits} onChange={handleLimitsChange} disabled={running} />
            <TelemetryConsole result={result} running={running} error={error} />
          </div>
        </div>

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-stroke/60 pt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">
          <span>
            AEGIS-RUN // UNTRUSTED CODE EXECUTION // {env.apiBaseUrl || "API URL UNCONFIGURED"}
          </span>
          <span>cgroup v2 · overlayfs · seccomp-bpf · pivot_root · clone(2)</span>
        </footer>
      </main>
    </div>
  );
}

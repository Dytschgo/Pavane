import {
  Check,
  Cpu,
  LoaderCircle,
  RefreshCw,
  SquareTerminal,
  Sparkles,
} from "lucide-react";
import type { Model, ProviderStatus } from "../lib/types";
import { Button } from "./ui/button";
import { GeminiKeyForm } from "./gemini-key-form";

export function Providers({
  models,
  providers,
  busy,
  onRefresh,
  onCredentialsChanged,
  error,
}: {
  models: Model[];
  providers: ProviderStatus[];
  busy: boolean;
  onRefresh: () => void;
  onCredentialsChanged?: () => void;
  error: string | null;
}) {
  return (
    <div className="provider-settings">
      <div className="connection-intro">
        <span>
          {models.length
            ? `${models.length} models ready`
            : busy
              ? "Finding your models…"
              : "Your model connections"}
        </span>
        <Button
          variant="ghost"
          size="small"
          onClick={onRefresh}
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <RefreshCw size={14} />
          )}
          Refresh
        </Button>
      </div>
      {[
        { id: "codex", name: "Codex", icon: SquareTerminal },
        { id: "ollama", name: "Ollama", icon: Cpu },
        { id: "gemini", name: "Gemini API", icon: Sparkles },
      ].map(({ id, name, icon: Icon }) => {
        const status = providers.find((provider) => provider.id === id);
        const connected = status?.state === "connected";
        return (
          <div className="connection" key={id}>
            <div className="provider-row">
              <div className={`provider-mark provider-${id}`}>
                <Icon size={21} />
              </div>
              <div className="provider-info">
                <strong>{name}</strong>
                <span>
                  {busy && !status
                    ? "Checking connection…"
                    : (status?.detail ??
                      (id === "codex"
                        ? "Uses your existing Codex CLI subscription login"
                        : id === "gemini"
                          ? "Add a Gemini API key"
                          : "Local models on this device"))}
                </span>
              </div>
              <span
                className={`connection-badge ${connected ? "connected" : ""}`}
              >
                {connected ? (
                  <>
                    <Check size={12} />
                    Connected
                  </>
                ) : busy ? (
                  "Checking"
                ) : status?.state === "signedOut" ? (
                  "Sign in needed"
                ) : (
                  "Not connected"
                )}
              </span>
            </div>
            {!!status?.limits.length && (
              <div className="usage-windows">
                {status.limits.map((window, index) => (
                  <div className="usage-window" key={index}>
                    <div>
                      <span>
                        {window.windowMinutes
                          ? window.windowMinutes >= 1440
                            ? `${Math.round(window.windowMinutes / 1440)}-day usage`
                            : `${Math.round(window.windowMinutes / 60)}-hour usage`
                          : window.label}
                      </span>
                      <strong>{Math.round(window.usedPercent)}%</strong>
                    </div>
                    <meter
                      min={0}
                      max={100}
                      value={window.usedPercent}
                      aria-label={window.label}
                    />
                    {window.resetsAt && (
                      <small>
                        Resets{" "}
                        {new Date(window.resetsAt * 1000).toLocaleString(
                          undefined,
                          {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </small>
                    )}
                  </div>
                ))}
              </div>
            )}
            {id === "codex" && status?.state === "signedOut" && (
              <p className="connection-help">
                Sign in once with <code>codex login</code>, then refresh. Pavane
                keeps your credentials with Codex.
              </p>
            )}
            {id === "gemini" && (
              <GeminiKeyForm onChanged={onCredentialsChanged ?? onRefresh} />
            )}
          </div>
        );
      })}
      {error && (
        <p role="status" className="field-error">
          {error}
        </p>
      )}
      <div className="settings-divider">
        <span>MORE PROVIDERS</span>
      </div>
      {[
        { name: "Anthropic", mark: "A" },
        { name: "xAI", mark: "x" },
      ].map((provider) => (
        <div className="provider-row planned-provider" key={provider.name}>
          <div className="provider-mark">{provider.mark}</div>
          <div className="provider-info">
            <strong>{provider.name}</strong>
            <span>
              {provider.name === "Anthropic"
                ? "API-key connection planned"
                : "Subscription adapter planned"}
            </span>
          </div>
          <span className="badge">Planned</span>
        </div>
      ))}
    </div>
  );
}

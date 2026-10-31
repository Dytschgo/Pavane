import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import type { Model, ProviderStatus } from "../lib/types";
import { Button } from "./ui/button";
import { GeminiKeyForm } from "./gemini-key-form";
import { ApiKeyForm } from "./api-key-form";
import { ClaudeKeyForm } from "./claude-key-form";
import { providerPresentation } from "../lib/provider-presentation";

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
  onCredentialsChanged?: (providerId: "gemini" | "claude" | "xai") => void;
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
      {["codex", "ollama", "gemini", "claude", "xai"].map((id) => {
        const { label: name, icon: Icon } = providerPresentation(id);
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
                          : id === "claude"
                            ? "Add a Claude Console API key"
                            : id === "xai"
                              ? "Add an xAI Console API key"
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
              <GeminiKeyForm
                onChanged={() =>
                  onCredentialsChanged
                    ? onCredentialsChanged("gemini")
                    : onRefresh()
                }
              />
            )}
            {id === "xai" && (
              <ApiKeyForm
                provider="xai"
                onChanged={() =>
                  onCredentialsChanged
                    ? onCredentialsChanged("xai")
                    : onRefresh()
                }
              />
            )}
            {id === "claude" && (
              <ClaudeKeyForm
                onChanged={() =>
                  onCredentialsChanged
                    ? onCredentialsChanged("claude")
                    : onRefresh()
                }
              />
            )}
          </div>
        );
      })}
      {error && (
        <p role="status" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

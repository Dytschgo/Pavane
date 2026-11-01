import { useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type { Model, ProviderStatus } from "../lib/types";
import { Button } from "./ui/button";
import { GeminiKeyForm } from "./gemini-key-form";
import { ApiKeyForm } from "./api-key-form";
import { ClaudeKeyForm } from "./claude-key-form";
import { providerPresentation } from "../lib/provider-presentation";

export function Providers({
  models,
  initialProvider = "codex",
  providers,
  busy,
  onRefresh,
  onCredentialsChanged,
  error,
}: {
  models: Model[];
  initialProvider?: string;
  providers: ProviderStatus[];
  busy: boolean;
  onRefresh: () => void;
  onCredentialsChanged?: (providerId: "gemini" | "claude" | "xai") => void;
  error: string | null;
}) {
  const [selected, setSelected] = useState(
    ["codex", "ollama", "gemini", "claude", "xai"].includes(initialProvider)
      ? initialProvider
      : "codex",
  );
  return (
    <div className="provider-settings">
      <div className="connection-intro">
        <span>
          {models.length
            ? `${models.length} ${models.length === 1 ? "model" : "models"} ready`
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
          {busy ? "Checking…" : "Recheck connections"}
        </Button>
      </div>
      <div className="connections-layout">
        <div className="connection-list" role="group" aria-label="Providers">
          {["codex", "ollama", "gemini", "claude", "xai"].map((id) => {
            const { label, icon: Icon } = providerPresentation(id);
            const status = providers.find((provider) => provider.id === id);
            return (
              <Button
                key={id}
                className="connection-choice"
                variant="ghost"
                aria-label={`Manage ${label}`}
                aria-pressed={selected === id}
                onClick={() => setSelected(id)}
              >
                <Icon size={19} />
                <strong>{label}</strong>
                <span>
                  {busy && !status
                    ? "Checking…"
                    : status?.state === "connected"
                      ? "Connected"
                      : status?.state === "signedOut"
                        ? "Sign in needed"
                        : status?.state === "unavailable"
                          ? "Needs attention"
                          : status?.state === "needsKey"
                            ? "Add API key"
                            : "Not connected"}
                </span>
              </Button>
            );
          })}
        </div>
        <div className="connection-editor">
          {["codex", "ollama", "gemini", "claude", "xai"].map((id) => {
            const { label: name, icon: Icon } = providerPresentation(id);
            const status = providers.find((provider) => provider.id === id);
            const noModels =
              status?.state === "connected" &&
              !models.some((model) => model.provider.toLowerCase() === id);
            return (
              <section
                className="connection"
                key={id}
                hidden={selected !== id}
                aria-label={`${name} setup`}
              >
                <div className="provider-row">
                  <div className={`provider-mark provider-${id}`}>
                    <Icon size={21} />
                  </div>
                  <div className="provider-info">
                    <strong>{name}</strong>
                  </div>
                </div>
                {noModels && (
                  <p className="connection-help" role="status">
                    {id === "ollama"
                      ? "Add a text model in Ollama, then recheck connections."
                      : "This connection has no available text models. Check model access, then recheck connections."}
                  </p>
                )}
                {!noModels &&
                  ((id === "codex" && status?.state !== "signedOut") ||
                    id === "ollama" ||
                    (!["codex", "ollama"].includes(id) &&
                      status &&
                      !["connected", "needsKey"].includes(status.state))) && (
                    <p className="connection-help">
                      {status?.detail ??
                        (id === "codex"
                          ? "Sign in with Codex, then recheck connections."
                          : "Start Ollama on this device, then recheck connections.")}
                    </p>
                  )}
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
                    Sign in once with <code>codex login</code>, then recheck
                    connections. Pavane keeps your credentials with Codex.
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
              </section>
            );
          })}
        </div>
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

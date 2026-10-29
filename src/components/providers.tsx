import {
  ArrowUpRight,
  Check,
  Cpu,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { Model } from "../lib/types";
import { Button } from "./ui/button";

const planned = [
  { name: "OpenAI", mark: "O", detail: "Codex subscription bridge" },
  { name: "Anthropic", mark: "A", detail: "Claude adapter" },
  { name: "Google", mark: "G", detail: "Gemini adapter" },
  { name: "xAI", mark: "x", detail: "Grok adapter" },
];

export function Providers({
  models,
  busy,
  onRefresh,
  error,
}: {
  models: Model[];
  busy: boolean;
  onRefresh: () => void;
  error: string | null;
}) {
  return (
    <div className="provider-settings">
      <div className="provider-row">
        <div className="provider-mark">
          <Cpu size={22} />
        </div>
        <div className="provider-info">
          <strong>Ollama</strong>
          <span>Local models · 127.0.0.1:11434</span>
        </div>
        <Button size="small" onClick={onRefresh} disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={15} />
          ) : models.length ? (
            <RefreshCw size={15} />
          ) : (
            <PlusIcon />
          )}
          <span>
            {busy ? "Checking" : models.length ? "Refresh" : "Connect"}
          </span>
        </Button>
      </div>
      {models.length > 0 && (
        <div className="provider-connected">
          <Check size={14} />
          {models.length} {models.length === 1 ? "model" : "models"} available{" "}
          <span>Local usage · no subscription quota</span>
        </div>
      )}
      {error && (
        <p role="status" className="field-error">
          {error}
        </p>
      )}
      <div className="settings-divider">
        <span>UP NEXT</span>
      </div>
      {planned.map((provider) => (
        <div className="provider-row" key={provider.name}>
          <div className="provider-mark">{provider.mark}</div>
          <div className="provider-info">
            <strong>{provider.name}</strong>
            <span>{provider.detail}</span>
          </div>
          <span className="badge">Planned</span>
        </div>
      ))}
      <div className="settings-note">
        <ArrowUpRight size={16} />
        <p>
          Subscriptions and API billing are separate. Connections and limits
          will appear when the provider supports them.
        </p>
      </div>
    </div>
  );
}

function PlusIcon() {
  return <span aria-hidden="true">+</span>;
}

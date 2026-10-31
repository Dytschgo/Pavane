import { ExternalLink, KeyRound, LoaderCircle, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";

type KeyProvider = "gemini" | "xai";

const connections = {
  gemini: {
    label: "Gemini API key",
    save: api.saveGeminiKey,
    remove: api.removeGeminiKey,
    saved: "API key saved.",
    removed: "API key removed.",
    saveLabel: "Save key",
    removeLabel: "Remove key",
    setupLabel: "Get API key",
    setupUrl: "https://aistudio.google.com/apikey",
    setupError: "Could not open Google AI Studio in your browser.",
    saveError:
      "Could not save the API key. Check Windows credential storage and try again.",
    removeError:
      "Could not remove the API key. Check Windows credential storage and try again.",
    help: "Sending may incur API charges. Keys are stored in Windows Credential Manager for this Pavane profile.",
  },
  xai: {
    label: "xAI API key",
    save: api.saveXaiKey,
    remove: api.removeXaiKey,
    saved: "xAI API key saved.",
    removed: "xAI API key removed.",
    saveLabel: "Save xAI key",
    removeLabel: "Remove xAI key",
    setupLabel: "Get xAI API key",
    setupUrl: "https://console.x.ai/team/default/api-keys",
    setupError: "Could not open the xAI Console in your browser.",
    saveError:
      "Could not save the xAI API key. Check Windows credential storage and try again.",
    removeError:
      "Could not remove the xAI API key. Check Windows credential storage and try again.",
    help: "Sending may incur API charges, separate from Grok subscriptions. Account quota is managed in the xAI Console. Keys are stored in Windows Credential Manager for this Pavane profile.",
  },
};

export function ApiKeyForm({
  provider,
  onChanged,
}: {
  provider: KeyProvider;
  onChanged: () => void;
}) {
  const connection = connections[provider];
  const [key, setKey] = useState("");
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const id = useId();
  const valid = key.length > 0 && key.length <= 2048 && !/[^!-~]/.test(key);
  const validation =
    key && !valid
      ? "Use an API key without spaces or non-ASCII characters."
      : null;
  async function change(action: "save" | "remove") {
    if (inFlight.current || (action === "save" && !valid)) return;
    inFlight.current = true;
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      if (action === "save") await connection.save(key);
      else await connection.remove();
      setKey("");
      setNotice(action === "save" ? connection.saved : connection.removed);
      onChanged();
    } catch {
      // Native errors are generic too. Never put an IPC exception that could
      // include the submitted secret back into the rendered page.
      setError(
        action === "save" ? connection.saveError : connection.removeError,
      );
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }
  return (
    <form
      className="api-key-form"
      aria-busy={!!pending}
      onSubmit={(event) => {
        event.preventDefault();
        void change("save");
      }}
    >
      <label htmlFor={id}>{connection.label}</label>
      <input
        id={id}
        className="text-input"
        type="password"
        value={key}
        onChange={(event) => {
          setKey(event.target.value);
          setError(null);
          setNotice(null);
        }}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={2048}
        readOnly={!!pending}
        placeholder="Paste a new key"
        aria-invalid={!!validation || !!error}
        aria-describedby={`${id}-help ${id}-feedback`}
      />
      <p id={`${id}-help`} className="connection-help">
        {connection.help}
      </p>
      <div className="api-key-actions">
        <Button type="submit" size="small" disabled={!valid || !!pending}>
          {pending === "save" ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <KeyRound size={14} />
          )}
          {pending === "save" ? "Saving…" : connection.saveLabel}
        </Button>
        <Button
          variant="ghost"
          size="small"
          disabled={!!pending}
          onClick={() => void change("remove")}
          title="Removes access for new requests. A response already sent may finish."
        >
          {pending === "remove" ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Trash2 size={14} />
          )}
          {pending === "remove" ? "Removing…" : connection.removeLabel}
        </Button>
        <Button
          variant="ghost"
          size="small"
          onClick={() => {
            void api
              .openExternal(connection.setupUrl)
              .catch(() => setError(connection.setupError));
          }}
        >
          <ExternalLink size={14} /> {connection.setupLabel}
        </Button>
      </div>
      <div id={`${id}-feedback`} aria-live="polite">
        {(validation || error) && (
          <p className="field-error">{validation || error}</p>
        )}
        {notice && <p className="connection-help">{notice}</p>}
      </div>
    </form>
  );
}

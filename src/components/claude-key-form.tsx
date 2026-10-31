import { ExternalLink, KeyRound, LoaderCircle, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";

export function ClaudeKeyForm({ onChanged }: { onChanged: () => void }) {
  const [key, setKey] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const id = useId();
  const validKey = key.length > 0 && key.length <= 2048 && !/[^!-~]/.test(key);
  const validWorkspace =
    !workspace ||
    (workspace.length <= 128 && /^wrkspc_[A-Za-z0-9_]+$/.test(workspace));
  const keyValidation =
    key && !validKey
      ? "Use an API key without spaces or non-ASCII characters."
      : null;
  const workspaceValidation = validWorkspace
    ? null
    : "Use a Workspace ID starting with wrkspc_ and containing only letters, numbers or underscores.";

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }
  async function change(action: "save" | "remove") {
    if (
      inFlight.current ||
      (action === "save" && (!validKey || !validWorkspace))
    )
      return;
    inFlight.current = true;
    setPending(action);
    clearFeedback();
    try {
      if (action === "save")
        await api.saveClaudeConnection(key, workspace || null);
      else await api.removeClaudeConnection();
      setKey("");
      setWorkspace("");
      setNotice(
        action === "save"
          ? "Claude connection saved."
          : "Claude connection removed.",
      );
      onChanged();
    } catch {
      // Never render an IPC exception that might include the submitted secret.
      setError(
        action === "save"
          ? "Could not save the Claude connection. Check Windows credential storage and try again."
          : "Could not remove the Claude connection. Check Windows credential storage and try again.",
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
      <label htmlFor={id}>Claude API key</label>
      <input
        id={id}
        className="text-input"
        type="password"
        value={key}
        onChange={(event) => {
          setKey(event.target.value);
          clearFeedback();
        }}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={2048}
        readOnly={!!pending}
        placeholder="Paste a new Console key"
        aria-invalid={!!keyValidation || !!error}
        aria-describedby={`${id}-help ${id}-feedback`}
      />
      <label htmlFor={`${id}-workspace`}>Workspace ID (optional)</label>
      <input
        id={`${id}-workspace`}
        className="text-input"
        type="text"
        value={workspace}
        onChange={(event) => {
          setWorkspace(event.target.value);
          clearFeedback();
        }}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={128}
        readOnly={!!pending}
        placeholder="wrkspc_…"
        aria-invalid={!validWorkspace}
        aria-describedby={`${id}-workspace-help ${id}-feedback`}
      />
      <p id={`${id}-workspace-help`} className="connection-help">
        Required if your key is not scoped to one workspace. Save the key and
        workspace together when replacing a connection.
      </p>
      <p id={`${id}-help`} className="connection-help">
        Sending may incur API charges. This Console connection is separate from
        Claude subscription usage. Stored in Windows Credential Manager for this
        Pavane profile.
      </p>
      <div className="api-key-actions">
        <Button
          type="submit"
          size="small"
          disabled={!validKey || !validWorkspace || !!pending}
        >
          {pending === "save" ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <KeyRound size={14} />
          )}
          {pending === "save" ? "Saving…" : "Save connection"}
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
          {pending === "remove" ? "Removing…" : "Remove connection"}
        </Button>
        <Button
          variant="ghost"
          size="small"
          onClick={() => {
            void api
              .openExternal("https://platform.claude.com/settings/keys")
              .catch(() =>
                setError("Could not open Claude Console in your browser."),
              );
          }}
        >
          <ExternalLink size={14} /> Get Claude API key
        </Button>
      </div>
      <div id={`${id}-feedback`} aria-live="polite">
        {(keyValidation || workspaceValidation || error) && (
          <p className="field-error">
            {keyValidation || workspaceValidation || error}
          </p>
        )}
        {notice && <p className="connection-help">{notice}</p>}
      </div>
    </form>
  );
}

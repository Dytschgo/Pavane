import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, errorText } from "../lib/api";
import type { Workspace } from "../lib/types";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";

export function WorkspaceEditor({
  workspace,
  onUpdate,
  onClose,
}: {
  workspace: Workspace;
  onUpdate: (saved: Workspace) => void;
  onClose: () => void;
}) {
  const [expected, setExpected] = useState(workspace);
  const [name, setName] = useState(workspace.name);
  const [instructions, setInstructions] = useState(workspace.instructions);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "load" | null>(null);
  const pending = useRef(false);
  const nameError =
    !name.trim() || Array.from(name).length > 80
      ? "Use a name of up to 80 characters."
      : null;
  const instructionsError =
    new TextEncoder().encode(instructions).byteLength > 8192
      ? "Instructions exceed 8 KiB. Shorten them to save."
      : null;
  const invalid = nameError ?? instructionsError;
  const kind =
    workspace.kind === "bots"
      ? "bot"
      : workspace.kind === "spaces"
        ? "space"
        : "project";

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current || invalid) return;
    pending.current = true;
    setBusy("save");
    setError(null);
    try {
      const saved = await api.updateWorkspace(expected, name, instructions);
      onUpdate(saved);
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  async function reload() {
    if (pending.current) return;
    pending.current = true;
    setBusy("load");
    try {
      const saved = await api.workspace(expected.id);
      setExpected(saved);
      setName(saved.name);
      setInstructions(saved.instructions);
      setError(null);
      onUpdate(saved);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      dismissible={!busy}
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose();
      }}
      title={`Edit ${kind}`}
      description="Changes apply to future messages. Existing chats stay here."
    >
      <form aria-busy={!!busy} onSubmit={(event) => void save(event)}>
        <label className="field-label" htmlFor="edit-workspace-name">
          Name
        </label>
        <input
          className="text-input"
          id="edit-workspace-name"
          value={name}
          maxLength={160}
          disabled={!!busy}
          onChange={(event) => setName(event.target.value)}
          required
          aria-invalid={!!nameError}
          aria-describedby={
            nameError || error ? "workspace-edit-error" : undefined
          }
        />
        <label className="field-label" htmlFor="edit-workspace-instructions">
          Instructions <span>optional</span>
        </label>
        <textarea
          className="text-input instructions-input"
          id="edit-workspace-instructions"
          value={instructions}
          maxLength={8192}
          disabled={!!busy}
          onChange={(event) => setInstructions(event.target.value)}
          aria-invalid={!!instructionsError}
          aria-describedby={
            instructionsError || error ? "workspace-edit-error" : undefined
          }
        />
        {(invalid || error) && (
          <p id="workspace-edit-error" className="composer-error" role="alert">
            {invalid ?? error}
          </p>
        )}
        {error && (
          <Button
            variant="ghost"
            size="small"
            disabled={!!busy}
            onClick={() => void reload()}
          >
            Load saved version
          </Button>
        )}
        <div className="dialog-actions">
          <Button disabled={!!busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!!busy || !!invalid}
          >
            {busy === "save"
              ? "Saving…"
              : busy === "load"
                ? "Loading…"
                : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

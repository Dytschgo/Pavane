import { useRef, useState } from "react";
import { api, errorText } from "../lib/api";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";

export function ChatRename({
  chatId,
  title,
  onSaved,
  onClose,
}: {
  chatId: string;
  title: string;
  onSaved: (title: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose();
      }}
      dismissible={!saving}
      title="Rename chat"
      description="Give this conversation a title you can find again."
    >
      <form
        aria-busy={saving}
        onSubmit={async (event) => {
          event.preventDefault();
          const next = value.trim();
          if (pending.current || !next) return;
          pending.current = true;
          setSaving(true);
          setError(null);
          try {
            await api.rename(chatId, next);
          } catch (failure) {
            setError(errorText(failure));
            return;
          } finally {
            pending.current = false;
            setSaving(false);
          }
          onSaved(next);
        }}
      >
        <label className="field-label" htmlFor="chat-title">
          Title
        </label>
        <input
          className="text-input"
          id="chat-title"
          value={value}
          maxLength={120}
          disabled={saving}
          onChange={(event) => setValue(event.target.value)}
          required
        />
        {error && (
          <p className="composer-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={saving || !value.trim()}
          >
            {saving ? "Saving…" : "Save title"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

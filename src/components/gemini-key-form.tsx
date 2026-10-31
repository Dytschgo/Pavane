import { ApiKeyForm } from "./api-key-form";

export function GeminiKeyForm({ onChanged }: { onChanged: () => void }) {
  return <ApiKeyForm provider="gemini" onChanged={onChanged} />;
}

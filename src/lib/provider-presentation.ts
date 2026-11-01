import {
  Asterisk,
  AudioLines,
  Cpu,
  Orbit,
  Sparkles,
  SquareTerminal,
} from "lucide-react";

const providers = {
  codex: { label: "Codex", icon: SquareTerminal, chatIcon: SquareTerminal },
  ollama: { label: "Ollama", icon: Cpu, chatIcon: AudioLines },
  gemini: { label: "Gemini API", icon: Sparkles, chatIcon: Sparkles },
  claude: { label: "Claude API", icon: Asterisk, chatIcon: Asterisk },
  xai: { label: "xAI API", icon: Orbit, chatIcon: Orbit },
};

export function providerPresentation(provider: string) {
  const id = provider.toLowerCase();
  return Object.hasOwn(providers, id)
    ? providers[id as keyof typeof providers]
    : { label: provider, icon: Cpu, chatIcon: AudioLines };
}

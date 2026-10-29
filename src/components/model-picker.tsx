import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Cpu, Layers3, Plus, Search } from "lucide-react";
import { useState } from "react";
import type { Model } from "../lib/types";
import { Button } from "./ui/button";

export function ModelPicker({
  models,
  selected,
  onSelect,
  onConnect,
  swarm,
  onSwarm,
}: {
  models: Model[];
  selected: string[];
  onSelect: (models: string[]) => void;
  onConnect: () => void;
  swarm: boolean;
  onSwarm: (swarm: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = models.filter((model) =>
    model.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="small" className="model-trigger">
          <Cpu size={15} />
          <span>
            {selected.length > 1
              ? `${selected.length} models`
              : (models.find((model) => model.id === selected[0])?.name ??
                "Choose model")}
          </span>
          <ChevronDown size={13} />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="model-menu"
          side="top"
          align="end"
          sideOffset={12}
          onCloseAutoFocus={() => setQuery("")}
        >
          <div className="model-search">
            <Search size={15} />
            <input
              aria-label="Search models"
              placeholder="Search models…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
          <Menu.Label className="menu-label">ON THIS DEVICE</Menu.Label>
          {visible.length === 0 && (
            <p className="menu-empty">
              {models.length
                ? "No matching models"
                : "Connect a provider to see models"}
            </p>
          )}
          {visible.map((model) => (
            <Menu.CheckboxItem
              className="menu-item"
              key={model.id}
              checked={selected.includes(model.id)}
              onSelect={(event) => {
                if (swarm) event.preventDefault();
              }}
              onCheckedChange={(checked) => {
                if (!swarm) onSelect([model.id]);
                else if (checked && selected.length < 4)
                  onSelect([...selected, model.id]);
                else if (!checked)
                  onSelect(selected.filter((id) => id !== model.id));
              }}
            >
              <Cpu size={16} />
              <span>
                {model.name}
                <small>{model.provider}</small>
              </span>
              <Menu.ItemIndicator>
                <Check size={15} />
              </Menu.ItemIndicator>
            </Menu.CheckboxItem>
          ))}
          <Menu.Separator className="menu-separator" />
          <Menu.CheckboxItem
            className="menu-item"
            checked={swarm}
            onCheckedChange={(checked) => {
              onSwarm(checked);
              if (!checked) onSelect(selected.slice(0, 1));
            }}
          >
            <Layers3 size={16} />
            <span>
              Compare models<small>Up to 4 parallel responses</small>
            </span>
            <Menu.ItemIndicator>
              <Check size={15} />
            </Menu.ItemIndicator>
          </Menu.CheckboxItem>
          <Menu.Separator className="menu-separator" />
          <Menu.Item className="menu-item" onSelect={onConnect}>
            <Plus size={16} />
            <span>Connect a provider</span>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

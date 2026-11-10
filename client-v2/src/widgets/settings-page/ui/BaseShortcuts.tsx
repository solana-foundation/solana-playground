import { Kbd, KbdGroup } from "@/shared/ui/kbd";

import BaseSettingsCard from "./BaseSettingsCard";

/** Spec 07, "The keyboard shortcuts list", by where each one works */
const SHORTCUTS: ReadonlyArray<[string, ReadonlyArray<[string, string[]]>]> = [
  [
    "Everywhere",
    [
      ["Open settings", ["Ctrl", ","]],
      ["Show or hide the console", ["Ctrl", "J"]],
    ],
  ],
  [
    "Learning shell",
    [
      ["Show or hide the sidebar", ["Ctrl", "B"]],
      ["Show or hide the assistant", ["Ctrl", "R"]],
      ["Show or hide files", ["Ctrl", "E"]],
    ],
  ],
  [
    "Editor",
    [
      ["Format the file", ["Ctrl", "S"]],
      ["Close the tab", ["Alt", "W"]],
    ],
  ],
  ["Terminal", [["Clear the terminal", ["Ctrl", "L"]]]],
  [
    "File explorer",
    [
      ["Create a file", ["Alt", "N"]],
      ["Rename", ["F2"]],
      ["Delete", ["Delete"]],
    ],
  ],
];

/** Read only, desktop only: a phone has no keyboard to speak of */
const BaseShortcuts = ({ mac }: { mac: boolean }) => (
  <BaseSettingsCard>
    {SHORTCUTS.map(([where, list]) => (
      // One rhythm for every row: where it works is a quiet first column,
      // named once per group, and hairlines fall only between groups
      <ul key={where} aria-label={where} className="flex flex-col py-1.5">
        {list.map(([action, keys], i) => (
          <li key={action} className="flex h-9 items-center gap-4 px-4">
            <span
              className="w-28 shrink-0 text-xs text-subtle"
              aria-hidden={i > 0}
            >
              {i === 0 ? where : ""}
            </span>
            <span className="min-w-0 flex-1 text-caption text-foreground">
              {action}
            </span>
            <KbdGroup>
              {keys.map((key) => (
                <Kbd key={key}>{mac && key === "Ctrl" ? "⌘" : key}</Kbd>
              ))}
            </KbdGroup>
          </li>
        ))}
      </ul>
    ))}
  </BaseSettingsCard>
);

export default BaseShortcuts;

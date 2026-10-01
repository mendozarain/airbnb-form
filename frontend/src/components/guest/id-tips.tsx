import { Maximize, Sun, Type } from "lucide-react";

const tips = [
  { icon: Maximize, text: "Whole ID in the frame" },
  { icon: Sun, text: "No glare or shadows" },
  { icon: Type, text: "Text is easy to read" }
];

export function IdTips() {
  return (
    <ul className="mt-3 grid grid-cols-3 gap-2">
      {tips.map(({ icon: Icon, text }) => (
        <li
          key={text}
          className="flex flex-col items-center gap-1 rounded-md bg-surface p-2 text-center text-xs text-ink-muted"
        >
          <Icon className="size-4 text-primary" strokeWidth={1.5} aria-hidden="true" />
          {text}
        </li>
      ))}
    </ul>
  );
}

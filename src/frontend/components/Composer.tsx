import { useState } from "react";

export interface ComposerAction {
  label: string;
  onSubmit: (content: string) => void;
  variant?: "primary" | "outline";
}

interface ComposerProps {
  placeholder: string;
  autoFocus?: boolean;
  initialValue?: string;
  /** Provide this OR `actions`, not both. */
  submitLabel?: string;
  onSubmit?: (content: string) => void;
  /** The first action is primary and bound to ⌘↵. */
  actions?: ComposerAction[];
  onCancel?: () => void;
}

export function Composer(
  {
    placeholder,
    autoFocus,
    initialValue,
    submitLabel,
    onSubmit,
    actions,
    onCancel,
  }: ComposerProps,
) {
  const [value, setValue] = useState(initialValue ?? "");

  const resolved: ComposerAction[] = actions ??
    (onSubmit
      ? [{ label: submitLabel ?? "Send", onSubmit, variant: "primary" }]
      : []);

  const run = (action: ComposerAction) => {
    const content = value.trim();
    if (!content) return;
    action.onSubmit(content);
    setValue("");
  };

  return (
    <div className="composer">
      <textarea
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (
            (e.metaKey || e.ctrlKey) && e.key === "Enter" && resolved[0]
          ) run(resolved[0]);
          if (e.key === "Escape" && onCancel) onCancel();
        }}
      />
      <div className="composer-actions">
        {resolved.map((action, i) => (
          <button
            key={action.label}
            type="button"
            className={action.variant === "outline" ||
                (i > 0 && !action.variant)
              ? "btn-outline"
              : "btn-primary"}
            disabled={!value.trim()}
            onClick={() => run(action)}
          >
            {action.label}
          </button>
        ))}
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <span className="composer-hint">⌘↵</span>
      </div>
    </div>
  );
}

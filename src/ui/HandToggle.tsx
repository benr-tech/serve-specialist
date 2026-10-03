import { ToggleGroup as TG } from 'radix-ui';
import type { Side } from '../pose/types';

/** Two-option switch with a sliding thumb. */
export function HandToggle({ value, onChange }: { value: Side; onChange: (v: Side) => void }) {
  return (
    <TG.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as Side)}
      aria-label="Hitting hand"
      className="relative inline-grid grid-cols-2 rounded-full bg-secondary p-1 text-sm font-semibold"
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-card shadow-soft transition-transform duration-500 ease-soft"
        style={{ transform: value === 'left' ? 'translateX(100%)' : 'none' }}
      />
      {(['right', 'left'] as const).map((h) => (
        <TG.Item
          key={h}
          value={h}
          className="relative z-10 cursor-pointer rounded-full px-5 py-2 text-muted-foreground transition-colors duration-300 outline-none focus-visible:ring-4 focus-visible:ring-ball/60 data-[state=on]:text-foreground"
        >
          {h === 'right' ? 'Right-handed' : 'Left-handed'}
        </TG.Item>
      ))}
    </TG.Root>
  );
}

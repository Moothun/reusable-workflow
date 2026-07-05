import { nodeVisual } from "@/lib/node-catalog";

type Props = {
  type: string;
  /** Container edge length in px. The icon and radius scale from it. */
  size?: number;
  className?: string;
};

/**
 * Monochrome node icon in a soft rounded container. Single source of truth for
 * node iconography across the card, palette, inspector, and copilot.
 */
export default function NodeIcon({ type, size = 34, className = "" }: Props) {
  const { Icon } = nodeVisual(type);
  const iconSize = Math.round(size * 0.62);
  const radius = Math.round(size * 0.34);
  return (
    <span
      className={`node-icon ${className}`}
      style={{ width: size, height: size, borderRadius: radius }}
      aria-hidden
    >
      <Icon size={iconSize} strokeWidth={1.75} absoluteStrokeWidth />
    </span>
  );
}

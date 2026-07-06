/**
 * Minimal brand mark — two nodes joined by a curved "noodle" strand.
 * Monochrome (currentColor) + 2px round strokes to match the node icon language.
 */
export default function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6.5 7.5C12 7.5 12 16.5 17.5 16.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="6.5" cy="7.5" r="2.6" fill="currentColor" />
      <circle cx="17.5" cy="16.5" r="2.6" fill="currentColor" />
    </svg>
  );
}

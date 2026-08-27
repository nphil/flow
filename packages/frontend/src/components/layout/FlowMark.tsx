interface FlowMarkProps {
  size?: number;
  className?: string;
}

/**
 * The Flow logo mark (design doc §1), inlined as JSX rather than `<img src="/logo.svg">` so
 * `currentColor` and `var(--accent)` actually cascade from the surrounding theme -- an
 * `<img>`-loaded SVG is an isolated document and can't see either.
 */
export function FlowMark({ size = 20, className }: FlowMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path
        d="M16 18 C16 44, 48 22, 48 46"
        stroke="var(--accent, #8839EF)"
        strokeWidth={6}
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="8" fill="currentColor" />
      <circle cx="48" cy="48" r="8" fill="var(--accent, #8839EF)" />
      <circle cx="47" cy="15" r="4.5" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

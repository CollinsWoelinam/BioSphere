/**
 * The BioSphere "Contour" mark: nested isopleths around a tracked point. Rings use the
 * theme accent, so the mark switches to its dark variant with the colour scheme.
 * Below 40 px the two-ring version keeps the lines from merging.
 */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  const small = size < 40;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden className={className}>
      {small ? (
        <>
          <g fill="none" stroke="var(--accent)" strokeWidth="13" strokeLinejoin="round">
            <circle cx="60" cy="60" r="51" />
            <path d="M60 30 C80 30 92 44 90 62 C88 80 74 90 58 89 C42 88 31 76 32 60 C33 44 42 30 60 30Z" />
          </g>
          <circle cx="61" cy="60" r="11" fill="var(--logo-core)" />
        </>
      ) : (
        <>
          <g fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinejoin="round">
            <circle cx="60" cy="60" r="52" />
            <path d="M56 24 C78 22 98 38 95 60 C92 82 74 95 54 92 C36 89 26 76 28 58 C30 42 38 25 56 24Z" />
            <path d="M64 42 C76 43 82 53 79 64 C76 75 66 79 58 76 C49 73 46 64 48 56 C50 48 55 41 64 42Z" />
          </g>
          <circle cx="64" cy="59" r="6.5" fill="var(--logo-core)" />
        </>
      )}
    </svg>
  );
}

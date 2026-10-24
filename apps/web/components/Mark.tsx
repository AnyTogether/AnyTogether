/** The two rings: AnyTogether's mark. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="at-g" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#4f7cff" />
          <stop offset=".55" stopColor="#b65cff" />
          <stop offset="1" stopColor="#2fe0c4" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="16" r="8.5" stroke="url(#at-g)" strokeWidth="2.5" />
      <circle cx="20" cy="16" r="8.5" stroke="url(#at-g)" strokeWidth="2.5" />
    </svg>
  );
}

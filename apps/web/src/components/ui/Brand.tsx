/**
 * RVEP wordmark — minimalist, Tesla-style geometric monogram + label.
 */
export function Brand({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dim = size === "lg" ? 48 : size === "md" ? 36 : 24;
  const fontSize = size === "lg" ? "text-2xl" : size === "md" ? "text-lg" : "text-sm";

  return (
    <div className="flex items-center gap-3 select-none">
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="RVEP"
      >
        <rect x="2" y="2" width="44" height="44" rx="12" stroke="url(#gradStroke)" strokeWidth="1.5" />
        <path
          d="M14 32V16H24a6 6 0 0 1 2.4 11.5L32 32M14 24h10"
          stroke="#fafafa"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <defs>
          <linearGradient id="gradStroke" x1="0" y1="0" x2="48" y2="48">
            <stop stopColor="#4d94ff" stopOpacity="0.5" />
            <stop offset="1" stopColor="#e31937" stopOpacity="0.4" />
          </linearGradient>
        </defs>
      </svg>
      <div className="flex flex-col leading-none">
        <span className={`${fontSize} font-semibold tracking-tight`}>RVEP</span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
          Remote Vehicle Edge
        </span>
      </div>
    </div>
  );
}

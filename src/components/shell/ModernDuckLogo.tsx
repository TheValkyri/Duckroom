export function ModernDuckLogo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className}>
      {/* Duck Beak */}
      <path d="M26 18C29 18 34 19.5 35 22C33.5 24.5 28 24 26 23.5V18Z" fill="url(#duck-beak-grad)" />
      {/* Duck Head & Neck */}
      <path
        d="M12 28C12 20 16 12 23 12C26.5 12 28.5 14.5 28.5 18C28.5 23 23 25 21 28C19.5 30 16 32 12 28Z"
        fill="currentColor"
        className="text-foreground"
      />
      {/* DJ Headphone Band */}
      <path d="M13 8C18 5 27 5 31 10" stroke="var(--primary)" strokeWidth="3.5" strokeLinecap="round" />
      {/* DJ Ear Cup */}
      <rect x="9" y="13" width="6" height="10" rx="3" fill="var(--primary)" />
      {/* Duck Eye */}
      <circle cx="21" cy="16" r="2" fill="var(--background)" />
      {/* Gradients */}
      <defs>
        <linearGradient id="duck-beak-grad" x1="26" y1="18" x2="35" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="oklch(0.75 0.22 55)" />
          <stop offset="1" stopColor="oklch(0.65 0.2 40)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

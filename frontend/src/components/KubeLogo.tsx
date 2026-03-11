export function KubeLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <rect width="32" height="32" rx="7" fill="#13141f" />
      <polygon points="16,2.5 28,9.5 28,22.5 16,29.5 4,22.5 4,9.5" fill="#326CE5" opacity="0.9" />
      <g stroke="white" strokeWidth="1.8" strokeLinecap="round">
        <line x1="16" y1="7.5" x2="16" y2="11.5" />
        <line x1="16" y1="20.5" x2="16" y2="24.5" />
        <line x1="8.6" y1="11.5" x2="12" y2="13.5" />
        <line x1="20" y1="18.5" x2="23.4" y2="20.5" />
        <line x1="8.6" y1="20.5" x2="12" y2="18.5" />
        <line x1="20" y1="13.5" x2="23.4" y2="11.5" />
      </g>
      <circle cx="16" cy="16" r="3" fill="white" />
      <circle cx="16" cy="16" r="6.5" fill="none" stroke="white" strokeWidth="1.4" opacity="0.6" />
    </svg>
  );
}

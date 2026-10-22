interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="100 100 824 824">
      <rect className="brand-mark__frame" x="100" y="100" width="824" height="824" rx="106" />
      <path className="brand-mark__glyph" d="M290 272 H386 V528 A126 126 0 0 0 638 528 V272 H734 V528 A222 222 0 0 1 290 528 Z" />
      <rect className="brand-mark__square" x="455" y="466" width="114" height="114" />
    </svg>
  );
}

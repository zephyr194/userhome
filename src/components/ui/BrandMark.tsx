interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="100 100 824 824">
      <rect className="brand-mark__frame" x="100" y="100" width="824" height="824" rx="184" />
      <rect className="brand-mark__block" x="307.2" y="531.2" width="192.0" height="192.0" rx="57.6" />
      <rect className="brand-mark__block" x="524.8" y="531.2" width="192.0" height="192.0" rx="57.6" />
      <rect className="brand-mark__block brand-mark__block--accent" x="416.0" y="300.8" width="192.0" height="192.0" rx="57.6" />
    </svg>
  );
}

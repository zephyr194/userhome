interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="100 100 824 824">
      <rect className="brand-mark__frame" x="100" y="100" width="824" height="824" rx="184" />
      <path className="brand-mark__glyph" d="M292 262 H388 V644 L436 692 H588 L636 644 V262 H732 V702 L646 788 H378 L292 702 Z" />
      <rect className="brand-mark__rail" x="388" y="372" width="248" height="24" />
      <rect className="brand-mark__rail" x="388" y="480" width="248" height="24" />
      <rect className="brand-mark__knob" x="424" y="346" width="76" height="76" rx="8" />
      <rect className="brand-mark__knob-accent" x="524" y="454" width="76" height="76" rx="8" />
      <rect className="brand-mark__cap" x="292" y="262" width="96" height="16" />
      <rect className="brand-mark__cap" x="636" y="262" width="96" height="16" />
    </svg>
  );
}

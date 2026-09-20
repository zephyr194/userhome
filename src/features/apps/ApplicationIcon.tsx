import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

function CopilotIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M7 8.5 4.5 6M17 8.5 19.5 6M8 6.5 9.5 4h5L16 6.5" />
      <rect x="4" y="7" width="16" height="11" rx="4" />
      <circle cx="9" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <path d="M9 15.5h6M8 18v2M16 18v2" />
    </svg>
  );
}

function CaddyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M18.5 7.5A8 8 0 1 0 18 17" />
      <path d="M18.5 4.5v6h-6" />
      <path d="M8 12h8" />
    </svg>
  );
}

function GitIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="m12 3 9 9-9 9-9-9 9-9Z" />
      <circle cx="9" cy="9" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="15" r="1.4" fill="currentColor" stroke="none" />
      <path d="M9 10.5v3a2 2 0 0 0 2 2h2.5M10.2 10.2l3.6 3.6" />
    </svg>
  );
}

function SshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h8M17 12v3M20 12v2M6.5 12h3" />
    </svg>
  );
}

function TerminalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m7 9 3 3-3 3M12.5 15H17" />
    </svg>
  );
}

function NpmIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M3 7h18v10H11v-7H8v7H3V7Z" />
      <path d="M14 10v4M17 10v4M14 10h6" />
    </svg>
  );
}

function CodeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="m16.5 4-9 4.5v7l9 4.5 4.5-2.5v-11L16.5 4Z" />
      <path d="m7.5 8.5 5.5 4-5.5 3M13 12.5l3.5-8.5v16L13 12.5Z" />
    </svg>
  );
}

function CursorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="m5 3 14 9-7 1.5L9 20 5 3Z" />
      <path d="m12 13.5 4 5" />
    </svg>
  );
}

function StarshipIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M14 4c3 1 5 3 6 6l-6.5 6.5-6-6L14 4Z" />
      <circle cx="15" cy="9" r="1.5" />
      <path d="m8 14-3 1 4 4 1-3M6 18l-2 2M10 20l-1 2" />
    </svg>
  );
}

function VimIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="m12 3 9 9-9 9-9-9 9-9Z" />
      <path d="M7.5 8.5h3L12 14l2-5.5h2.5M9 8.5V7M15 8.5V7" />
    </svg>
  );
}

function ApplicationFallbackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M4 9h16M8 6.5h.01M11 6.5h.01" />
    </svg>
  );
}

const ICONS: Record<string, IconComponent> = {
  caddy: CaddyIcon,
  copilot: CopilotIcon,
  cursor: CursorIcon,
  ghostty: TerminalIcon,
  git: GitIcon,
  npm: NpmIcon,
  openssh: SshIcon,
  starship: StarshipIcon,
  tmux: TerminalIcon,
  vim: VimIcon,
  "visual-studio-code": CodeIcon,
  zsh: TerminalIcon,
};

export function ApplicationIcon({
  iconKey,
  className,
}: {
  iconKey: string;
  className?: string;
}) {
  const Icon = ICONS[iconKey] ?? ApplicationFallbackIcon;
  return (
    <Icon
      className={className}
      aria-hidden="true"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    />
  );
}

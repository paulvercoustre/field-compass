import React from 'react';

// Shared line icons, drawn on a 24 px grid at a 1.75 stroke so they sit
// evenly beside 13-14 px text.
type IconProps = { className?: string };

const Icon: React.FC<IconProps & { children: React.ReactNode }> = ({ className = 'w-4 h-4', children }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const RefreshIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2" />
    <path d="M18.5 2.5v3.7h-3.7M5.5 21.5v-3.7h3.7" />
  </Icon>
);

export const PlusIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
);

export const ListIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></Icon>
);

export const ChartIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></Icon>
);

export const TargetIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></Icon>
);

export const UsersIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
);

export const SettingsIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);

export const LogoutIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></Icon>
);

export const UserCogIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Icon>
);

export const SidebarIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></Icon>
);

export const ChevronDownIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><path d="M6 9l6 6 6-6" /></Icon>
);

export const ChevronUpDownIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><path d="M8 9l4-4 4 4M8 15l4 4 4-4" /></Icon>
);

export const AlertTriangleIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </Icon>
);

export const CheckIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><path d="M20 6 9 17l-5-5" /></Icon>
);

export const CheckCircleIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></Icon>
);

export const XCircleIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></Icon>
);

export const ExternalLinkIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></Icon>
);

export const PencilIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></Icon>
);

/** The one mark for anything AI does or decides, so it is recognisable everywhere. */
/** Translation: a character and a letter. */
export const TranslateIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}>
    <path d="M4 5h9M8.5 3v2M11 5c-.8 3.6-3.2 6.6-6.5 8.2M6.5 9c1 1.8 2.6 3.3 4.5 4.2" />
    <path d="m12 21 4.5-10 4.5 10M13.6 17.5h5.8" />
  </Icon>
);

export const SparkleIcon: React.FC<IconProps> = (p) => (
  <Icon {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </Icon>
);

/** How long ago, in a few words: "just now", "5 min ago", "3 h ago", then the date ("2 Oct"). */
export const timeAgo = (iso: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

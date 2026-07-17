/**
 * Stable colors per optionRole for 3D boards (engineering viewer).
 * HSL-ish hex palette — visual only, not design-system tokens for CSS chrome.
 */

const PALETTE = [
  '#5b6ee1', // brand-ish blue
  '#2a9d8f', // teal
  '#e9c46a', // sand
  '#e76f51', // coral
  '#6d597a', // plum
  '#457b9d', // steel
  '#90be6d', // green
  '#f4a261', // orange
] as const;

export function colorForOptionRole(optionRole: string): string {
  const key = optionRole.trim().toUpperCase() || 'DEFAULT';
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length]!;
}

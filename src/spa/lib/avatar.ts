const AVATAR_COLORS = [
  "#4285F4",
  "#EA4335",
  "#FBBC04",
  "#34A853",
  "#9C27B0",
  "#FF6D01",
  "#00BCD4",
  "#795548",
  "#607D8B",
  "#E91E63",
];

export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xfffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
}

export function senderName(author: string): string {
  const m = author.match(/^"?([^"<]+)"?\s*</);
  return m?.[1]?.trim() ?? (author.replace(/<[^>]+>/g, "").trim() || author);
}

export function senderInitial(author: string): string {
  return senderName(author).charAt(0).toUpperCase() || "?";
}

export function senderDomain(author: string): string {
  const m = author.match(/<([^>]+)>/);
  const email = (m?.[1] ?? author).toLowerCase();
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

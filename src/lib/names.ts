function nameParts(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

// "Aisha Ibrahim" → "Aisha"
export function getFirstName(name: string): string {
  return nameParts(name)[0] ?? "";
}

// "Aisha Ibrahim" → "AI", "Aisha Bello Ibrahim" → "AI", "Aisha" → "A"
export function getInitials(name: string): string {
  const parts = nameParts(name);
  if (parts.length === 0) return "";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}

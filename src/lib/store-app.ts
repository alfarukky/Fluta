// The home-screen app for a store's booking page: the label under its icon.

// Phones cut longer icon labels off.
export const APP_SHORT_NAME_MAX = 12;

// The store's name if it fits; otherwise as many whole words as fit
// ("FreshFold Laundry" → "FreshFold"), or the first word cut to fit.
export function getAppShortName(storeName: string): string {
  const name = storeName.trim().replace(/\s+/g, " ");
  if (name.length <= APP_SHORT_NAME_MAX) return name;
  let short = "";
  for (const word of name.split(" ")) {
    const next = short ? `${short} ${word}` : word;
    if (next.length > APP_SHORT_NAME_MAX) break;
    short = next;
  }
  return (short || name.slice(0, APP_SHORT_NAME_MAX)).replace(/[\s&,.:;-]+$/, "");
}

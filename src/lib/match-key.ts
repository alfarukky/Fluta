// The form of a label used to compare it, ignoring case and extra spaces:
// trimmed, repeated whitespace collapsed to one space, lowercased. Service
// names are stored with this key (Service.nameKey, unique per store; the
// service_name_key migration filled existing rows the same way), and
// categories, search and the category filter match on it.
export function toMatchKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

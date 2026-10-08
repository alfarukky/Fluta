// Hands the email to the sign-in form after joining a store from an
// invitation, without putting it in a URL (no personal data in URLs). Kept in
// this tab's sessionStorage and read once. Storage can be unavailable
// (private modes, blocked site data); the form then just starts empty.
const KEY = "fluta:sign-in-email";

export function rememberSignInEmail(email: string): void {
  try {
    sessionStorage.setItem(KEY, email);
  } catch {
    // Not available: the person types their email.
  }
}

export function takeSignInEmail(): string | null {
  try {
    const email = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return email;
  } catch {
    return null;
  }
}

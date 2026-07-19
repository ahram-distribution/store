/**
 * Safe clipboard write that never throws.
 *
 * The Clipboard API requires a secure context (HTTPS) and recent user
 * activation.  It is unavailable in many Chinese browser in-app WebViews,
 * older Safari versions, and insecure (HTTP) contexts.
 *
 * Returns true if the text was copied, false otherwise.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

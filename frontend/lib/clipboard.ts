// Copy text to the clipboard. `navigator.clipboard` exists only in a secure
// context (HTTPS or localhost) — the dashboard opened as http://<robot-ip>:3007
// has none — so fall back to a hidden textarea + execCommand('copy'), which
// still works there. Resolves true when the text was copied.
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch { /* permission denied, not focused, … — try the fallback */ }
  }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.top = '-1000px'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    el.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

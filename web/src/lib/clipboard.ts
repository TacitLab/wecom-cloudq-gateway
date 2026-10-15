// Clipboard API is unavailable on ordinary HTTP origins. Keep a synchronous
// selection-based fallback for those deployments and browsers denying writeText.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall back to a selected textarea when the async API is blocked.
  }

  const activeElement = document.activeElement
  const selection = window.getSelection()
  const ranges = Array.from({ length: selection?.rangeCount ?? 0 }, (_, i) => selection!.getRangeAt(i).cloneRange())
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.tabIndex = -1
  field.setAttribute('aria-hidden', 'true')
  Object.assign(field.style, { position: 'fixed', top: '0', left: '0', opacity: '0', fontSize: '16px' })
  document.body.appendChild(field)
  try {
    field.focus({ preventScroll: true })
    field.select()
    field.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
    if (activeElement instanceof HTMLElement) activeElement.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      ranges.forEach((range) => selection.addRange(range))
    }
  }
}

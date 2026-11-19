/** Hides the credentials of every URL in a text (`rtsps://bblp:code@host` → `rtsps://***@host`). */
export function redactUrls(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@');
}

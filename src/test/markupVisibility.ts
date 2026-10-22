const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);
const TAG = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
const HIDDEN_ATTRIBUTE = /\shidden(?=[\s=/]|$)/;

/**
 * Whether `text` appears in the static markup outside every element that carries
 * the `hidden` attribute. Server-rendered markup keeps hidden panels in place, so
 * this is how tests tell a mounted-but-hidden section from a visible one.
 */
export function isTextVisible(markup: string, text: string): boolean {
  const hiddenStack: boolean[] = [];
  const isHidden = () => hiddenStack.some(Boolean);
  let cursor = 0;
  let match: RegExpExecArray | null;
  TAG.lastIndex = 0;
  while ((match = TAG.exec(markup)) !== null) {
    if (match.index > cursor && markup.slice(cursor, match.index).includes(text) && !isHidden()) {
      return true;
    }
    cursor = TAG.lastIndex;
    const [, closing, name = "", attributes = "", selfClosing] = match;
    if (closing) {
      hiddenStack.pop();
    } else if (!selfClosing && !VOID_ELEMENTS.has(name.toLowerCase())) {
      hiddenStack.push(HIDDEN_ATTRIBUTE.test(attributes));
    }
  }
  return markup.slice(cursor).includes(text) && !isHidden();
}

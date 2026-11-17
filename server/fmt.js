/* Server twin of public/js/fmt.js: question text may carry light markup
   (**bold**, *italic*, __underline__, ~~strike~~, `code`, ^sup^, ~sub~, "- "
   bullets). The server only needs the plain text, for CSV headers, so a
   spreadsheet never shows stray asterisks. Keep the rules in step with the
   client file. */
const RULES = [
  [/`([^`\n]+)`/g, "$1"],
  [/\*\*(?!\s)(.+?)(?<!\s)\*\*/g, "$1"],
  [/__(?!\s)(.+?)(?<!\s)__/g, "$1"],
  [/~~(?!\s)(.+?)(?<!\s)~~/g, "$1"],
  [/\*(?![\s*])([^*\n]+?)(?<![\s*])\*/g, "$1"],
  [/\^(?!\s)([^^\n]+?)(?<!\s)\^/g, "$1"],
  [/~(?![\s~])([^~\n]+?)(?<![\s~])~/g, "$1"]
];

export function stripFormat(src) {
  let s = String(src ?? "").replace(/^[-•] /gm, "");
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s.replace(/\s*\n\s*/g, " ").trim();
}

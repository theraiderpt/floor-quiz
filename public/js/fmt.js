"use strict";

/* Light text formatting for questions and answer options. The host types
   plain text with a few markers (the editor toolbar inserts them):
     **bold**  *italic*  __underline__  ~~strike~~  `code`  ^sup^  ~sub~
     "- " at the start of a line for a bullet, a new line for a line break.
   Stored as that plain text, never as HTML. Everything is escaped first and
   then only a fixed set of tags is produced, so no host-typed markup can
   inject script or attributes. Keep the rules in step with server/fmt.js. */
(function () {
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = s => s.replace(/[&<>"']/g, c => ESC[c]);

  const INLINE = [
    [/\*\*(?!\s)(.+?)(?<!\s)\*\*/g, "<strong>$1</strong>"],
    [/__(?!\s)(.+?)(?<!\s)__/g, "<u>$1</u>"],
    [/~~(?!\s)(.+?)(?<!\s)~~/g, "<s>$1</s>"],
    [/\*(?![\s*])([^*\n]+?)(?<![\s*])\*/g, "<em>$1</em>"],
    [/\^(?!\s)([^^\n]+?)(?<!\s)\^/g, "<sup>$1</sup>"],
    [/~(?![\s~])([^~\n]+?)(?<![\s~])~/g, "<sub>$1</sub>"]
  ];
  const inline = s => INLINE.reduce((acc, [re, to]) => acc.replace(re, to), esc(s));

  /* Code spans are cut out first so markers inside them stay literal. */
  function spans(line) {
    return line.split(/(`[^`\n]+`)/).map((p, i) => i % 2 ? "<code>" + esc(p.slice(1, -1)) + "</code>" : inline(p)).join("");
  }

  function html(src) {
    const out = [];
    let list = false;
    for (const line of String(src ?? "").split("\n")) {
      const bullet = /^[-•] (.*)$/.exec(line);
      if (bullet) {
        if (!list) { out.push("<ul>"); list = true; }
        out.push("<li>" + spans(bullet[1]) + "</li>");
        continue;
      }
      if (list) { out.push("</ul>"); list = false; }
      out.push(spans(line) + "<br>");
    }
    if (list) out.push("</ul>");
    return out.join("").replace(/(<br>)+$/, "");
  }

  /* For places that show plain text (lists, summaries, "the answer was"). */
  function plain(src) {
    let s = String(src ?? "").replace(/^[-•] /gm, "");
    s = s.replace(/`([^`\n]+)`/g, "$1");
    for (const [re] of INLINE) s = s.replace(re, "$1");
    return s.replace(/\s*\n\s*/g, " ").trim();
  }

  /* innerHTML is safe here: html() only emits the tags listed above. */
  function set(node, src) { node.innerHTML = html(src); return node; }

  window.Fmt = { html, plain, set };
})();

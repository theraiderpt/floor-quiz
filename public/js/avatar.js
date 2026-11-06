// Cartoon player avatars drawn as inline SVG, shared by the phone and projector pages.
// Built with createElementNS (no markup strings) and presentation attributes only,
// because the CSP blocks inline style and we never want player data parsed as markup.
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var INK = "#2b2b3a";
  var SLOTS = { c: 8, s: 4, e: 6, m: 6, h: 6 };
  var DEFAULT = { c: 0, s: 0, e: 0, m: 0, h: 0 };

  // [fill, outline]. The darker outline keeps light bodies visible on a white phone screen
  // and dark ones visible on the projector's dark theme.
  var COLOURS = [
    ["#ff6b6b", "#b83a3a"], ["#ffb547", "#b8761a"], ["#ffe14d", "#a8901a"], ["#5bd67c", "#2c8a47"],
    ["#3ec5e0", "#1d7f94"], ["#5b8def", "#2d55a8"], ["#a77bf0", "#6740a8"], ["#ff7ec7", "#b0447f"]
  ];

  // Every shape has its head top at y=22 and the face around y=50..74 so hats and the
  // headset line up. `ear` is the body's left edge at ear height, where the headset cup sits.
  var SHAPES = [
    { name: "blob", ear: 15, d: "M14,58 A36,36 0 1 1 86,58 A36,36 0 1 1 14,58 Z" },
    { name: "square", ear: 15, d: "M32,22 H68 A18,18 0 0 1 86,40 V76 A18,18 0 0 1 68,94 H32 A18,18 0 0 1 14,76 V40 A18,18 0 0 1 32,22 Z" },
    { name: "bean", ear: 23, d: "M50,22 C70,22 78,34 78,52 C78,74 72,96 50,96 C28,96 22,74 22,52 C22,34 30,22 50,22 Z" },
    { name: "ghost", ear: 15, d: "M14,58 A36,36 0 0 1 86,58 V92 q-6,-8 -12,0 q-6,8 -12,0 q-6,-8 -12,0 q-6,8 -12,0 q-6,-8 -12,0 q-6,8 -12,0 Z" }
  ];

  function el(parent, tag, attrs) {
    var node = document.createElementNS(NS, tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function line(g, d, w) {
    return el(g, "path", { d: d, fill: "none", stroke: INK, "stroke-width": w || 3.5, "stroke-linecap": "round", "stroke-linejoin": "round" });
  }

  function star(g, cx, cy, r) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = Math.PI / 5 * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
      pts.push((cx + rr * Math.cos(a)).toFixed(1) + "," + (cy + rr * Math.sin(a)).toFixed(1));
    }
    el(g, "polygon", { points: pts.join(" "), fill: INK, "stroke-linejoin": "round" });
  }

  var EYES = [
    { name: "round", draw: function (g) {
      [38, 62].forEach(function (x) {
        el(g, "circle", { cx: x, cy: 50, r: 7.5, fill: "#fff", stroke: INK, "stroke-width": 2 });
        el(g, "circle", { cx: x + 1.5, cy: 51, r: 3.5, fill: INK });
      });
    } },
    { name: "sleepy", draw: function (g) { line(g, "M31,50 Q38,55 45,50 M55,50 Q62,55 69,50"); } },
    { name: "stars", draw: function (g) { star(g, 38, 50, 7.5); star(g, 62, 50, 7.5); } },
    { name: "wink", draw: function (g) {
      el(g, "circle", { cx: 38, cy: 50, r: 4.5, fill: INK });
      line(g, "M55,51 L62,47 L69,51");
    } },
    { name: "googly", draw: function (g) {
      el(g, "circle", { cx: 37, cy: 49, r: 9, fill: "#fff", stroke: INK, "stroke-width": 2 });
      el(g, "circle", { cx: 33, cy: 53, r: 4, fill: INK });
      el(g, "circle", { cx: 63, cy: 51, r: 6, fill: "#fff", stroke: INK, "stroke-width": 2 });
      el(g, "circle", { cx: 66, cy: 48, r: 2.8, fill: INK });
    } },
    { name: "happy", draw: function (g) { line(g, "M32,52 Q38,44 44,52 M56,52 Q62,44 68,52"); } }
  ];

  var MOUTHS = [
    { name: "grin", draw: function (g) { line(g, "M40,67 Q50,77 60,67"); } },
    { name: "tongue", draw: function (g) {
      el(g, "path", { d: "M46,70 V76 A4,4 0 0 0 54,76 V70 Z", fill: "#ff5c8a", stroke: INK, "stroke-width": 2 });
      line(g, "M39,68 Q50,74 61,68");
    } },
    { name: "o", draw: function (g) { el(g, "ellipse", { cx: 50, cy: 70, rx: 5, ry: 6, fill: INK }); } },
    { name: "smirk", draw: function (g) { line(g, "M42,71 Q52,72 59,65"); } },
    { name: "teeth", draw: function (g) {
      el(g, "path", { d: "M38,66 H62 Q60,79 50,79 Q40,79 38,66 Z", fill: "#fff", stroke: INK, "stroke-width": 2.5, "stroke-linejoin": "round" });
      line(g, "M38.5,70 H61.5 M46,66 V70 M54,66 V70", 1.6);
    } },
    { name: "wobbly", draw: function (g) { line(g, "M38,70 q3,-4 6,0 q3,4 6,0 q3,-4 6,0 q3,4 6,0", 3); } }
  ];

  var HEADWEAR = [
    // A headset rather than a hat is the default: everyone playing works in a contact centre.
    { name: "headset", draw: function (g, shape) {
      var l = shape.ear, r = 100 - shape.ear;
      el(g, "path", { d: "M" + l + ",54 C" + l + ",8 " + r + ",8 " + r + ",54", fill: "none", stroke: "#4a4a57", "stroke-width": 5, "stroke-linecap": "round" });
      [l, r].forEach(function (x) { el(g, "rect", { x: x - 6, y: 47, width: 12, height: 19, rx: 5, fill: "#4a4a57", stroke: INK, "stroke-width": 1.5 }); });
      el(g, "path", { d: "M" + l + ",64 Q" + (l + 2) + ",78 35,76", fill: "none", stroke: "#4a4a57", "stroke-width": 3, "stroke-linecap": "round" });
      el(g, "circle", { cx: 35, cy: 76, r: 4, fill: "#ff3d6e", stroke: INK, "stroke-width": 1.5 });
    } },
    { name: "none", draw: function () {} },
    { name: "party", draw: function (g) {
      el(g, "polygon", { points: "37,28 63,25 54,1", fill: "#ffd23f", stroke: INK, "stroke-width": 2, "stroke-linejoin": "round" });
      line(g, "M42,20 L57,18 M46,12 L55,11", 2);
      el(g, "circle", { cx: 54, cy: 2, r: 4, fill: "#ff5c8a", stroke: INK, "stroke-width": 1.5 });
    } },
    { name: "crown", draw: function (g) {
      el(g, "polygon", { points: "33,28 33,10 41,19 50,6 59,19 67,10 67,28", fill: "#ffcc33", stroke: "#a87a00", "stroke-width": 2, "stroke-linejoin": "round" });
      el(g, "circle", { cx: 50, cy: 22, r: 2.6, fill: "#ff3d6e" });
    } },
    { name: "beanie", draw: function (g) {
      el(g, "path", { d: "M24,32 C24,8 76,8 76,32 Z", fill: "#4ab3ff", stroke: INK, "stroke-width": 2, "stroke-linejoin": "round" });
      el(g, "rect", { x: 21, y: 28, width: 58, height: 9, rx: 4.5, fill: "#2f86d6", stroke: INK, "stroke-width": 2 });
      el(g, "circle", { cx: 50, cy: 8, r: 6, fill: "#fff", stroke: INK, "stroke-width": 2 });
    } },
    { name: "viking", draw: function (g) {
      el(g, "path", { d: "M30,22 C22,18 16,8 18,0 C22,8 28,12 36,14 Z M70,22 C78,18 84,8 82,0 C78,8 72,12 64,14 Z", fill: "#fff6dc", stroke: INK, "stroke-width": 2, "stroke-linejoin": "round" });
      el(g, "path", { d: "M27,32 C27,6 73,6 73,32 Z", fill: "#a9b4c2", stroke: INK, "stroke-width": 2, "stroke-linejoin": "round" });
      el(g, "rect", { x: 25, y: 28, width: 50, height: 6, rx: 3, fill: "#7d8896", stroke: INK, "stroke-width": 1.5 });
    } }
  ];

  function normalize(raw) {
    var out = {};
    for (var k in SLOTS) {
      var v = raw ? raw[k] : undefined;
      out[k] = Number.isInteger(v) && v >= 0 ? v % SLOTS[k] : 0;
    }
    return out;
  }

  function random() {
    var out = {};
    for (var k in SLOTS) out[k] = Math.floor(Math.random() * SLOTS[k]);
    out.h = 0;
    return out;
  }

  function svg(av, size) {
    var a = normalize(av), px = String(size || 64), shape = SHAPES[a.s], col = COLOURS[a.c];
    var root = el(null, "svg", { viewBox: "0 0 100 100", width: px, height: px, "class": "avatar", "aria-hidden": "true" });
    el(root, "path", { d: shape.d, fill: col[0], stroke: col[1], "stroke-width": 3, "stroke-linejoin": "round" });
    // Rosy cheeks are what make the faces read as friendly at thumbnail size.
    el(root, "circle", { cx: 30, cy: 62, r: 4.5, fill: "#ff8fa3", opacity: 0.55 });
    el(root, "circle", { cx: 70, cy: 62, r: 4.5, fill: "#ff8fa3", opacity: 0.55 });
    EYES[a.e].draw(el(root, "g", {}));
    MOUTHS[a.m].draw(el(root, "g", {}));
    HEADWEAR[a.h].draw(el(root, "g", {}), shape);
    return root;
  }

  function names(list) { return list.map(function (x) { return x.name; }); }

  window.Avatar = {
    SLOTS: SLOTS,
    DEFAULT: DEFAULT,
    NAMES: { s: names(SHAPES), e: names(EYES), m: names(MOUTHS), h: names(HEADWEAR) },
    normalize: normalize,
    random: random,
    svg: svg
  };
})();

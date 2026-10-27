// Refuses random keyboard text ("asdfgh", "cascascavasv", "zzzz") in names, categories, addresses and descriptions.
// A computer cannot know every real word (Filipino product names like "galunggong" or "kangkong" are fine), so this
// looks for the patterns that keyboard mashing leaves and real words almost never have.
const { HttpError } = require("./errors");

const VOWELS = /[aeiouyáéíóúñ]/;   // y counts as a vowel ("pechay", "rhythm")
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "abcdefghijklmnopqrstuvwxyz"];
// Letter pairs that (almost) never occur inside English or Filipino words, but often in mashed keys
const RARE_PAIRS = new Set(("bq bx cj cv cx dx fg fj fq fv fx fz gj gq gv gx hj hx jb jc jd jf jg jh jj jk jl jm jn jp jq jr js jt jv jw jx jz "
  + "kj kq kx kz lx mx mz pq pv px qb qc qd qf qg qh qj qk ql qm qn qo qp qq qr qs qt qv qw qx qy qz sj sv sx "
  + "vb vc vd vf vg vh vj vk vm vn vp vq vt vw vx vz wj wq wv wx xj xk xq xv xz yq yv zf zj zq zx").split(" "));

/** Why one word looks random, or "" when it looks like a real word. */
function wordProblem(raw) {
  const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");   // strip quotes, dots, brackets around it
  if (word.length <= 2 || /\d/.test(word)) return "";                  // "ni", "5pcs", "1.5L", "A-1"
  if (word.length <= 5 && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) return "";   // acronyms: PC, BBQ, SM
  const w = word.toLowerCase();
  if (/(.)\1\1/.test(w)) return "the same letter three times";
  if (!VOWELS.test(w)) return "no vowels";
  if (/[^aeiouyáéíóúñ\W\d_]{4,}/.test(w)) return "too many consonants in a row";
  if (/^(.{2,3})\1{2,}/.test(w)) return "the same letters repeated";
  for (const row of KEYBOARD_ROWS) for (let i = 0; i + 4 <= row.length; i++) if (w.includes(row.slice(i, i + 4))) return "keys typed in a row";
  for (let i = 0; i + 1 < w.length; i++) if (RARE_PAIRS.has(w.slice(i, i + 2))) return "letters that do not go together";
  return "";
}

/**
 * A short name (product, category, unit, supplier, business, person, section, address).
 * Every word must look real. Returns the trimmed value.
 */
function checkName(value, label, { max = 150, person = false } = {}) {
  const v = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!v) throw new HttpError(400, `${label} is required.`);
  if (v.length > max) throw new HttpError(400, `${label} can have at most ${max} characters.`);
  if (!/\p{L}/u.test(v)) throw new HttpError(400, `${label} needs at least one letter.`);
  const allowed = person ? /^[\p{L} .'-]+$/u : /^[\p{L}\p{N} .,'&()\/#%+-]+$/u;
  if (!allowed.test(v)) {
    throw new HttpError(400, `${label} has characters that are not allowed${person ? " (use letters, spaces, dots, dashes and apostrophes)" : ""}.`);
  }
  for (const word of v.split(/[\s\-\/]+/)) {
    const why = wordProblem(word);
    if (why) throw new HttpError(400, `${label}: "${word}" does not look like a real word (${why}). Please check the spelling.`);
  }
  return v;
}

/**
 * Longer free text (maintenance issue, inspection remarks, about text, notes). Typos and short forms are fine,
 * but it must read as words: most words must look real, and no long word may be random.
 */
function checkText(value, label, { max = 1000, required = true } = {}) {
  const v = String(value ?? "").trim();
  if (!v) { if (required) throw new HttpError(400, `${label} is required.`); return ""; }
  if (v.length > max) throw new HttpError(400, `${label} can have at most ${max} characters.`);
  const words = v.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, "")).filter((w) => /\p{L}/u.test(w));
  if (!words.length) throw new HttpError(400, `${label} needs real words.`);
  const bad = words.filter((w) => wordProblem(w));
  const longBad = bad.find((w) => w.length >= 6);
  if (longBad) throw new HttpError(400, `${label}: "${longBad}" does not look like a real word. Please check the spelling.`);
  if (bad.length * 2 > words.length) throw new HttpError(400, `${label} does not look like real words. Please write it in words.`);
  return v;
}

/** Philippine phone number: 09XXXXXXXXX, +639XXXXXXXXX or a landline; spaces and dashes allowed. */
function checkPhone(value, label = "Contact number") {
  const v = String(value ?? "").trim();
  const digits = v.replace(/[\s()-]/g, "");
  if (!/^\+?\d{7,13}$/.test(digits)) throw new HttpError(400, `${label}: please enter a valid phone number, for example 0917-123-4567.`);
  return v;
}

/** Stall number like A-1, B12 or Wet-03. */
function checkStallNumber(value) {
  const v = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,14}$/.test(v)) throw new HttpError(400, "Stall number: letters, numbers and dashes only, for example A-1.");
  return v;
}

module.exports = { checkName, checkText, checkPhone, checkStallNumber, wordProblem };

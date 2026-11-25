// Pure text helpers: tag tokens, tag insertion, paste splitting, txt/csv import, seeds.

export type TokenKind = "text" | "tag" | "speaker" | "emoji";
export interface Token {
  kind: TokenKind;
  text: string;
  from: number;
  to: number;
}

const SPEAKER_RE = /<\|speaker:\d{1,2}\|>/y;
// Emoji with optional variation selector / ZWJ sequences (e.g. 😮‍💨, ⏸️).
const EMOJI_RE = /(?:\p{Extended_Pictographic}(?:️)?(?:‍\p{Extended_Pictographic}(?:️)?)*)/uy;

/** Splits a line into plain text, `[cues]`, `<|speaker:N|>` and emoji tokens. */
export function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let textStart = 0;
  const flush = (end: number) => {
    if (end > textStart) out.push({ kind: "text", text: s.slice(textStart, end), from: textStart, to: end });
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "[") {
      const close = s.indexOf("]", i + 1);
      const nl = s.indexOf("\n", i + 1);
      if (close > i && (nl < 0 || close < nl)) {
        flush(i);
        out.push({ kind: "tag", text: s.slice(i, close + 1), from: i, to: close + 1 });
        i = close + 1;
        textStart = i;
        continue;
      }
    } else if (c === "<") {
      SPEAKER_RE.lastIndex = i;
      const m = SPEAKER_RE.exec(s);
      if (m) {
        flush(i);
        out.push({ kind: "speaker", text: m[0], from: i, to: i + m[0].length });
        i += m[0].length;
        textStart = i;
        continue;
      }
    } else {
      EMOJI_RE.lastIndex = i;
      const m = EMOJI_RE.exec(s);
      if (m && m[0].length > 0) {
        flush(i);
        out.push({ kind: "emoji", text: m[0], from: i, to: i + m[0].length });
        i += m[0].length;
        textStart = i;
        continue;
      }
    }
    i++;
  }
  flush(s.length);
  return out;
}

/** Text without cues, speaker tokens or emoji — what is actually spoken. */
export function plainText(s: string): string {
  return tokenize(s)
    .filter((t) => t.kind === "text")
    .map((t) => t.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** `囁き` → `[囁き]` for bracket models; emoji and already bracketed tags stay as they are. */
export function normalizeTag(tag: string, syntax: "brackets" | "emoji"): string {
  const t = tag.trim();
  if (!t) return "";
  if (syntax === "emoji") return t;
  if (t.startsWith("[") && t.endsWith("]")) return t;
  if (t.startsWith("<|")) return t;
  return `[${t.replace(/^\[|\]$/g, "")}]`;
}

/** Replaces the selection [from, to) with the tag; returns the new text and cursor (after the tag). */
export function insertTag(text: string, from: number, to: number, tag: string): { text: string; cursor: number } {
  const a = Math.max(0, Math.min(from, to, text.length));
  const b = Math.min(text.length, Math.max(from, to));
  // Never insert inside an existing [..] or <|..|>: move to its end.
  let at = a;
  for (const tok of tokenize(text)) {
    if (tok.kind !== "text" && tok.from < at && at < tok.to) at = tok.to;
  }
  const end = at === a ? b : at;
  const out = text.slice(0, at) + tag + text.slice(end);
  return { text: out, cursor: at + tag.length };
}

/** Splits pasted text into lines: at newlines and after each 。 (outside cues), keeping closing quotes. */
export function splitForPaste(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.replace(/\r\n?/g, "\n").split("\n")) {
    let cur = "";
    let depth = 0;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      cur += c;
      if (c === "[") depth++;
      else if (c === "]" && depth > 0) depth--;
      else if (c === "。" && depth === 0) {
        while (i + 1 < raw.length && "」』）)】".includes(raw[i + 1])) cur += raw[++i];
        if (cur.trim()) out.push(cur.trim());
        cur = "";
      }
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

/**
 * Pasting `pasted` over [from, to) of `text`: one piece stays in the line,
 * several make the line hold the first piece and new lines for the rest.
 */
export function applyPaste(text: string, from: number, to: number, pasted: string): string[] {
  const parts = splitForPaste(pasted);
  if (parts.length <= 1) return [text.slice(0, from) + pasted.replace(/[\r\n]+/g, "") + text.slice(to)];
  const before = text.slice(0, from);
  const after = text.slice(to);
  const res = [before + parts[0], ...parts.slice(1)];
  res[res.length - 1] += after;
  return res.map((r) => r.trim()).filter((r) => r.length > 0);
}

export interface ImportedLine {
  castName: string | null;
  text: string;
}

function parseCsvRow(row: string, sep: string): string[] {
  const f: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (q) {
      if (c === '"' && row[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"' && cur === "") q = true;
    else if (c === sep) {
      f.push(cur);
      cur = "";
    } else cur += c;
  }
  f.push(cur);
  return f;
}

/**
 * VOICEVOX-compatible import: each non-empty line is `キャラ,テキスト` (or tab separated, CSV quoting allowed),
 * or a bare text. A first field longer than 24 characters, or holding a cue, is taken as text.
 */
export function parseScript(content: string): ImportedLine[] {
  const out: ImportedLine[] = [];
  const body = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    const sep = line.includes("\t") ? "\t" : ",";
    const f = parseCsvRow(line, sep);
    if (f.length >= 2) {
      const name = f[0].trim();
      const text = f.slice(1).join(sep === "\t" ? "\t" : ",").trim();
      if (name && name.length <= 24 && !name.includes("[") && !name.includes("<|") && text) {
        out.push({ castName: name, text });
        continue;
      }
    }
    out.push({ castName: null, text: line.trim() });
  }
  return out;
}

export type SeedMode = "random" | "fixed" | "sequential";

/** The seed of take `k` (0-based) of a batch; null lets the engine draw one. */
export function seedFor(mode: SeedMode, base: number, k: number): number | null {
  if (mode === "random") return null;
  if (mode === "fixed") return base;
  return base + k;
}

export function uid(): string {
  return crypto.randomUUID();
}

/** The worker voice name of a library voice (matches Voice::worker_name in Rust). */
export function workerVoiceName(voiceId: string): string {
  return "v" + voiceId.replace(/-/g, "");
}

export const CAST_COLORS = ["#e8735a", "#5aa9e8", "#8fd16a", "#c98be8", "#e8c35a", "#5ae8c8", "#e85a9b", "#9aa3b5"];

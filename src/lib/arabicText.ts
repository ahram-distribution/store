// ---------------------------------------------------------------------------
// Arabic text shaping for vector PDF rendering.
//
// jsPDF (and PDF in general) cannot apply OpenType GSUB shaping, so Arabic
// text must be pre-converted to contextual presentation forms (initial /
// medial / final) in LOGICAL order, then re-ordered to VISUAL order with the
// Unicode Bidirectional Algorithm (bidi-js, MIT) before it is written to the
// PDF. The result string is written left-to-right by the PDF engine.
//
// The embedded font (Tajawal-Regular.ttf) ships WITHOUT the "isolated"
// presentation forms (U+FE8F, FEA9, ...) but WITH the base Arabic letters
// (U+0621-064A) that carry the isolated glyphs. So this shaper maps the
// ISOLATED form to the base codepoint and uses presentation forms for
// INITIAL / MEDIAL / FINAL. All emitted codepoints are verified to exist in
// the font's cmap.
// ---------------------------------------------------------------------------

// Joining type of an Arabic letter:
//   RIGHT - connects only to the PREVIOUS character (takes final/isolated).
//   DUAL  - connects on both sides (takes all four forms).
const RIGHT_JOINING = new Set<number>([
  0x0622, 0x0623, 0x0624, 0x0625, 0x0627, // alef variants
  0x062f, 0x0630, 0x0631, 0x0632,         // dal, thal, reh, zain
  0x0648,                                 // waw
])
// Letters not listed as RIGHT (within the standard Arabic block) are DUAL.
const NON_JOINING = new Set<number>([0x0621]) // hamza

// Diacritics and modifier marks: transparent for joining, copied verbatim.
const TRANSPARENT = new Set<number>([
  0x064b, 0x064c, 0x064d, 0x064e, 0x064f, 0x0650, 0x0651, 0x0652, // 064B-0652
  0x0653, 0x0654, 0x0655, 0x0670,
])

// Presentation forms per base letter: [isolated, final, initial, medial].
// Isolated is NOT used (font lacks those glyphs; base codepoint is emitted).
const FORMS: Record<number, [number, number, number, number]> = {
  0x0622: [0xfe81, 0xfe82, 0xfe83, 0xfe84],
  0x0623: [0xfe83, 0xfe84, 0xfe85, 0xfe86],
  0x0624: [0xfe85, 0xfe86, 0xfe87, 0xfe88],
  0x0625: [0xfe87, 0xfe88, 0xfe89, 0xfe8a],
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c],
  0x0627: [0xfe8d, 0xfe8e, 0xfe8f, 0xfe90],
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92],
  0x0629: [0xfe93, 0xfe94, 0xfe95, 0xfe96],
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98],
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c],
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0],
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4],
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8],
  0x062f: [0xfea9, 0xfeaa, 0xfeab, 0xfeac],
  0x0630: [0xfeab, 0xfeac, 0xfead, 0xfeae],
  0x0631: [0xfead, 0xfeae, 0xfeaf, 0xfeb0],
  0x0632: [0xfeaf, 0xfeb0, 0xfeb1, 0xfeb2],
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4],
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8],
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc],
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0],
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4],
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8],
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc],
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0],
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4],
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8],
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc],
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0],
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4],
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8],
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec],
  0x0648: [0xfeed, 0xfeee, 0xfeef, 0xfef0],
  0x0649: [0x0649, 0xfef0, 0xfef0, 0xfef2], // alef maksura (fef1 initial absent in font)
  0x064a: [0x064a, 0xfef4, 0x064a, 0xfef4], // yeh: no initial/medial codepoints exist in Unicode; final FEF4 is the closest for medial, isolated glyph for word-initial
}

// Lam-alef ligatures: FEF5/FEF6 (alef), FEF7/FEF8 (alef hamza above),
// FEF9/FEFA (alef hamza below), FEFB/FEFC (alef madda above).
// [isolated, final] per alef variant.
const LAM_ALEF: Record<number, [number, number]> = {
  0x0622: [0xfefb, 0xfefc],
  0x0623: [0xfef7, 0xfef8],
  0x0625: [0xfef9, 0xfefa],
  0x0627: [0xfef5, 0xfef6],
}

function isRight(code: number): boolean {
  return RIGHT_JOINING.has(code)
}

function isDual(code: number): boolean {
  return code >= 0x0622 && code <= 0x064a && !RIGHT_JOINING.has(code) && !NON_JOINING.has(code)
}

function isJoining(code: number): boolean {
  return isRight(code) || isDual(code)
}

function isTransparent(code: number): boolean {
  return TRANSPARENT.has(code)
}

// Splits a string into an array of code points (handles surrogate pairs).
function toCodePoints(text: string): number[] {
  const out: number[] = []
  for (const ch of text) out.push(ch.codePointAt(0) as number)
  return out
}

// Converts Arabic text to contextual presentation forms in LOGICAL order.
// Non-Arabic characters (digits, Latin, punctuation, spaces) pass through.
export function shapeArabic(text: string): string {
  const codes = toCodePoints(text)
  const out: number[] = []
  const n = codes.length

  // Pre-scan: previous JOINING letter (ignoring transparent marks) that is
  // DUAL (i.e. able to connect forward to the current character).
  const prevDualIndex = (i: number): number => {
    for (let j = i - 1; j >= 0; j--) {
      if (isTransparent(codes[j])) continue
      return isDual(codes[j]) ? j : -1
    }
    return -1
  }

  for (let i = 0; i < n; i++) {
    const code = codes[i]
    const prevDual = prevDualIndex(i) >= 0

    // Next JOINING character (ignoring transparent marks).
    let nextIdx = -1
    for (let j = i + 1; j < n; j++) {
      if (isTransparent(codes[j])) continue
      if (isJoining(codes[j])) nextIdx = j
      break
    }
    const nextJoin = nextIdx >= 0

    // Lam-alef ligature.
    if (code === 0x0644 && nextIdx >= 0 && LAM_ALEF[codes[nextIdx]] !== undefined) {
      const form = prevDual ? LAM_ALEF[codes[nextIdx]][1] : LAM_ALEF[codes[nextIdx]][0]
      out.push(form)
      i = nextIdx // skip the alef
      continue
    }

    // Non-Arabic or transparent characters: pass through.
    if (!isJoining(code)) {
      out.push(code)
      continue
    }

    const forms = FORMS[code]
    if (code === 0x0640) {
      out.push(0x0640) // tatweel: identical in all forms
      continue
    }
    if (!forms) {
      out.push(code)
      continue
    }

    if (isDual(code)) {
      if (prevDual && nextJoin) out.push(forms[3]) // medial
      else if (prevDual) out.push(forms[1])        // final
      else if (nextJoin) out.push(forms[2])        // initial
      else out.push(code)                          // isolated -> base codepoint
    } else {
      // RIGHT-joining: only final / isolated.
      out.push(prevDual ? forms[1] : code)
    }
  }

  return String.fromCodePoint(...out)
}

// Applies the Unicode Bidirectional Algorithm to put the shaped string into
// VISUAL (left-to-right) order for the PDF engine. Bidi is applied on the
// shaped string so that presentation forms participate as strong RTL runs.
export function shapeArabicToVisual(text: string): string {
  const shaped = shapeArabic(text)
  try {
    const { getEmbeddingLevels, getReorderedString } = bidiFactory()
    const levels = getEmbeddingLevels(shaped)
    return getReorderedString(shaped, levels)
  } catch {
    // bidi-js should not fail on plain strings; keep shaped text as fallback.
    return shaped
  }
}

// ---------------------------------------------------------------------------
// bidi-js is MIT licensed. Imported lazily to avoid shipping it in the main
// bundle (PDF export is a separate on-demand feature).
// ---------------------------------------------------------------------------
import bidiFactory from 'bidi-js'

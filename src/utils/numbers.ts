// ---------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH — Numeric display formatting.
//
// Project standard: numeric values must be rendered with English digits (0-9)
// only, across every screen. All screens and components must import number
// formatting from this module. No screen may implement its own number
// formatting logic (no raw `toLocaleString` / `Intl.NumberFormat` calls for
// display purposes).
//
// Layout: (a) digit latinization helpers, (b) canonical number formatters.
// ---------------------------------------------------------------------------

const ARABIC_INDIC_DIGITS = /[\u0660-\u0669]/g
const EASTERN_ARABIC_INDIC_DIGITS = /[\u06F0-\u06F9]/g

/** Translates Arabic (٠-٩) and Eastern Arabic (۰-۹) digits, plus Arabic
 * decimal/thousands separators, into their English (ASCII) equivalents. */
export function toEnglishDigits(value: string): string {
  return value
    .replace(ARABIC_INDIC_DIGITS, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 0x0030))
    .replace(EASTERN_ARABIC_INDIC_DIGITS, (c) => String.fromCharCode(c.charCodeAt(0) - 0x06F0 + 0x0030))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/٪/g, '%')
}

/** Forces every digit in the given rendered output to be an English digit. */
function englishDigits(value: string): string {
  return toEnglishDigits(value)
}

export interface FormatNumberOptions {
  /** Minimum fraction digits to show (default 0). */
  minFractionDigits?: number
  /** Maximum fraction digits to show (default 0). */
  maxFractionDigits?: number
  /** Whether to use thousands grouping (default true). */
  grouping?: boolean
}

/** Canonical decimal number formatter. Always renders English digits. */
export function formatNumber(value: number, options: FormatNumberOptions = {}): string {
  const {
    minFractionDigits = 0,
    maxFractionDigits = minFractionDigits,
    grouping = true,
  } = options
  if (!Number.isFinite(value)) return '0'
  return englishDigits(
    new Intl.NumberFormat('en-US', {
      style: 'decimal',
      useGrouping: grouping,
      minimumFractionDigits: minFractionDigits,
      maximumFractionDigits: maxFractionDigits,
    }).format(value),
  )
}

/** Whole-number formatter (rounds and groups). */
export function formatInteger(value: number): string {
  return formatNumber(Math.round(value), { maxFractionDigits: 0 })
}

/** Fixed-precision decimal formatter. */
export function formatDecimal(value: number, fractionDigits = 2): string {
  return formatNumber(value, {
    minFractionDigits: fractionDigits,
    maxFractionDigits: fractionDigits,
  })
}

/** Percentage formatter; always renders English digits plus the % sign. */
export function formatPercent(value: number, fractionDigits = 0): string {
  return `${formatNumber(value, {
    minFractionDigits: fractionDigits,
    maxFractionDigits: fractionDigits,
  })}%`
}

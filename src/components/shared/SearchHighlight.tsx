import React from 'react';
import { normalizeArabic } from '../../utils/smartSearch';

interface SearchHighlightProps {
  text: string;
  query: string;
  className?: string;
}

export const SearchHighlight: React.FC<SearchHighlightProps> = ({ text, query, className = '' }) => {
  if (!query || !text) return <span className={className}>{text}</span>;

  const normalizedText = normalizeArabic(text);
  const normalizedQuery = normalizeArabic(query);
  const words = normalizedQuery.split(/\s+/).filter(Boolean);

  // Build highlight ranges
  const ranges: Array<{ start: number; end: number }> = [];
  for (const word of words) {
    if (word.length < 2) continue;
    let idx = normalizedText.indexOf(word);
    while (idx !== -1) {
      ranges.push({ start: idx, end: idx + word.length });
      idx = normalizedText.indexOf(word, idx + 1);
    }
  }

  if (ranges.length === 0) return <span className={className}>{text}</span>;

  // Sort and merge overlapping ranges
  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i].start <= last.end) {
      last.end = Math.max(last.end, ranges[i].end);
    } else {
      merged.push({ ...ranges[i] });
    }
  }

  // Build segments
  const segments: React.ReactNode[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (cursor < range.start) {
      segments.push(<span key={`p${cursor}`}>{text.slice(cursor, range.start)}</span>);
    }
    segments.push(
      <mark key={`h${range.start}`} className="bg-amber-200 text-amber-900 rounded px-0.5">
        {text.slice(range.start, range.end)}
      </mark>
    );
    cursor = range.end;
  }
  if (cursor < text.length) {
    segments.push(<span key={`e${cursor}`}>{text.slice(cursor)}</span>);
  }

  return <span className={className}>{segments}</span>;
};

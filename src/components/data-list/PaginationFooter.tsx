import { type PaginationFooterProps } from '../../types/data-list'

function getPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const pages: (number | 'ellipsis')[] = [1]

  if (current > 3) pages.push('ellipsis')

  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  for (let i = start; i <= end; i++) {
    pages.push(i)
  }

  if (current < total - 2) pages.push('ellipsis')

  pages.push(total)

  return pages
}

export function PaginationFooter({ page, totalPages, onChange }: PaginationFooterProps) {
  if (totalPages <= 1) return null

  const pages = getPageNumbers(page, totalPages)

  return (
    <div className="flex items-center justify-center gap-1" dir="ltr">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="px-2.5 py-1.5 text-xs font-medium text-text-secondary bg-white border border-border rounded-lg hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        السابق
      </button>

      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span key={'e' + i} className="w-8 h-8 flex items-center justify-center text-xs text-text-muted">
            ...
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={'w-8 h-8 rounded-lg text-xs font-semibold transition-colors ' +
              (p === page
                ? 'bg-primary text-white shadow-sm'
                : 'bg-white border border-border text-text-secondary hover:bg-surface')
            }
          >
            {p}
          </button>
        )
      )}

      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="px-2.5 py-1.5 text-xs font-medium text-text-secondary bg-white border border-border rounded-lg hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        التالي
      </button>
    </div>
  )
}

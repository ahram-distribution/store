import { type CardGridProps } from '../../types/data-list'

export function CardGrid({ children, className = '' }: CardGridProps) {
  return (
    <div className={'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 ' + className}>
      {children}
    </div>
  )
}

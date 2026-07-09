import { type CardGridProps } from '../../types/data-list'

export function CardGrid({ children, className = '' }: CardGridProps) {
  return (
    <div className={'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 ' + className}>
      {children}
    </div>
  )
}

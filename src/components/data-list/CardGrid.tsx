import { type CardGridProps } from '../../types/data-list'

export function CardGrid({ children, className = '' }: CardGridProps) {
  return (
    <div className={'grid grid-cols-2 md:grid-cols-5 gap-3 ' + className}>
      {children}
    </div>
  )
}

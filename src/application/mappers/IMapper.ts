export interface IMapper<TSource, TTarget> {
  map(source: TSource): TTarget
}

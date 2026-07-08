export const UnitType = {
  Piece: 'piece',
  Dozen: 'dozen',
  Carton: 'carton',
} as const

export type UnitType = (typeof UnitType)[keyof typeof UnitType]

export const UnitTypeLabel: Record<UnitType, string> = {
  piece: 'قطعة',
  dozen: 'دستة',
  carton: 'كرتونة',
}

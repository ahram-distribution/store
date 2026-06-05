export function generateEmployeeCode(role: string, sequence: number): string {
  const prefix = role.slice(0, 3).toUpperCase()
  return `${prefix}-${String(sequence).padStart(5, '0')}`
}

export function generateCustomerCode(sequence: number): string {
  return `CUS-${String(sequence).padStart(6, '0')}`
}

export function generateOrderCode(sequence: number): string {
  return `ORD-${String(sequence).padStart(6, '0')}`
}

export function generateVisitCode(sequence: number): string {
  return `VIS-${String(sequence).padStart(6, '0')}`
}

export function generateCollectionCode(sequence: number): string {
  return `COL-${String(sequence).padStart(6, '0')}`
}

export function generateReturnCode(sequence: number): string {
  return `RET-${String(sequence).padStart(6, '0')}`
}

export function generateCreditNoteCode(sequence: number): string {
  return `CN-${String(sequence).padStart(6, '0')}`
}

export function generateAuctionCode(sequence: number): string {
  return `AUC-${String(sequence).padStart(6, '0')}`
}

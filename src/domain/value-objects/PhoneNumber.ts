export interface PhoneNumber {
  readonly number: string
  readonly countryCode: string
}

export function createPhoneNumber(number: string, countryCode: string = '+2'): PhoneNumber {
  return { number, countryCode }
}

export function formatPhoneNumber(phone: PhoneNumber): string {
  return `${phone.countryCode}${phone.number}`
}

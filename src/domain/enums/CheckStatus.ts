export const CheckStatus = {
  Received: 'received',
  Deposited: 'deposited',
  Cleared: 'cleared',
  Bounced: 'bounced',
} as const

export type CheckStatus = (typeof CheckStatus)[keyof typeof CheckStatus]

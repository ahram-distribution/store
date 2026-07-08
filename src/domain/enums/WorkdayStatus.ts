export const WorkdayStatus = {
  Active: 'active',
  Completed: 'completed',
  Interrupted: 'interrupted',
} as const

export type WorkdayStatus = (typeof WorkdayStatus)[keyof typeof WorkdayStatus]

/**
 * Client-safe dashboard section constants.
 * No Mongoose imports — safe to use in Client Components.
 */

export type DashboardSectionId =
  | 'focus'
  | 'timeline'
  | 'tasks'
  | 'habits'
  | 'streakProtection'
  | 'spending'
  | 'spendingWarning'
  | 'groupBills'
  | 'notes'
  | 'continue'
  | 'weeklyReview'

export interface DashboardSectionDef {
  id: DashboardSectionId
  visible: boolean
  order: number
}

export const DEFAULT_SECTIONS: DashboardSectionDef[] = [
  { id: 'focus',            visible: true,  order: 0  },
  { id: 'timeline',         visible: true,  order: 1  },
  { id: 'tasks',            visible: true,  order: 2  },
  { id: 'habits',           visible: true,  order: 3  },
  { id: 'streakProtection', visible: true,  order: 4  },
  { id: 'spending',         visible: true,  order: 5  },
  { id: 'spendingWarning',  visible: true,  order: 6  },
  { id: 'groupBills',       visible: true,  order: 7  },
  { id: 'notes',            visible: true,  order: 8  },
  { id: 'continue',         visible: true,  order: 9  },
  { id: 'weeklyReview',     visible: true,  order: 10 },
]

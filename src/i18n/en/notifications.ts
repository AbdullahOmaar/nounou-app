/** Notifications behind the bell (owner rule: no alert cards on Home) */
export const notifications = {
  title: 'Notifications',
  empty: 'No notifications — all good ✅',
  kind: {
    notPickedUp: 'Present but not picked up',
    proofsPending: 'Proofs awaiting review',
    overdue: 'Overdue amounts due',
    reportsMissing: 'Unpublished reports',
    absentStreak: 'Repeated absence',
    photoCap: 'Photos reached the daily limit',
  },
  notPickedUpBody: '{count} children are present and still not picked up after the end of the day',
  proofsPendingBody: '{count} payment proofs awaiting your review',
  overdueBody: 'Total overdue: {amount}',
  reportsMissingBody: '{count} reports not published for open days',
  absentStreakBody: '{name} was absent {count} days in the last two weeks',
  photoCapBody: "Today's photos reached the limit set in Settings",
}

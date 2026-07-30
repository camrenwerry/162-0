export type Route = '/' | '/draft' | '/leaderboard' | '/updates'
export type NavigationBlocker = () => boolean

export function documentTitleForRoute(route: Route): string {
  const page = {
    '/': 'Home',
    '/draft': 'Classic Draft',
    '/leaderboard': 'Leaderboard',
    '/updates': 'Game Updates',
  }[route]
  return `${page} | Pennant Pursuit`
}

export function routeScrollBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? 'auto' : 'smooth'
}

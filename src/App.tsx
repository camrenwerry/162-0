import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import HomeScreen from './components/home/HomeScreen'
import PennantPursuitLogo from './components/PennantPursuitLogo'
import {
  documentTitleForRoute,
  routeScrollBehavior,
  type NavigationBlocker,
  type Route,
} from './appNavigation'

const ClassicMode = lazy(() => import('./components/draft/ClassicMode'))
const GameUpdatesScreen = lazy(() => import('./components/updates/GameUpdatesScreen'))
const LeaderboardScreen = lazy(() => import('./components/leaderboard/LeaderboardScreen'))

function getRoute(): Route {
  if (window.location.pathname === '/draft') return '/draft'
  if (window.location.pathname === '/leaderboard') return '/leaderboard'
  if (window.location.pathname === '/updates') return '/updates'
  return '/'
}

function getLocalLocation(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function RouteLoading({ label }: { label: string }) {
  return (
    <main className="route-loading" aria-label={label} aria-busy="true" aria-live="polite">
      <div>
        <PennantPursuitLogo className="route-loading__logo" compact priority />
        <p>{label}</p>
      </div>
    </main>
  )
}

function App() {
  const [route, setRoute] = useState<Route>(getRoute)
  const [navigationRevision, setNavigationRevision] = useState(0)
  const locationRef = useRef(getLocalLocation())
  const routeFocusRef = useRef<HTMLDivElement>(null)
  const navigationBlockerRef = useRef<NavigationBlocker | null>(null)

  const registerNavigationBlocker = useCallback((blocker: NavigationBlocker | null) => {
    navigationBlockerRef.current = blocker
  }, [])

  useEffect(() => {
    const handlePopState = () => {
      const nextRoute = getRoute()
      const blocker = navigationBlockerRef.current
      if (blocker && !blocker()) {
        window.history.pushState({}, '', locationRef.current)
        return
      }
      navigationBlockerRef.current = null
      setRoute(nextRoute)
      setNavigationRevision((revision) => revision + 1)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    locationRef.current = getLocalLocation()
    document.title = documentTitleForRoute(route)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: routeScrollBehavior(reducedMotion) })
    const focusFrame = window.requestAnimationFrame(() => {
      const pageTarget = document.querySelector<HTMLElement>('[data-route-focus]')
      const focusTarget = pageTarget ?? routeFocusRef.current
      focusTarget?.focus()
    })
    return () => window.cancelAnimationFrame(focusFrame)
  }, [navigationRevision, route])

  const navigate = (nextRoute: Route) => {
    const blocker = navigationBlockerRef.current
    if (nextRoute !== route && blocker && !blocker()) return
    navigationBlockerRef.current = null
    if (nextRoute !== route) window.history.pushState({}, '', nextRoute)
    setRoute(nextRoute)
  }

  let screen: ReactNode
  if (route === '/draft') {
    screen = (
      <Suspense fallback={<RouteLoading label="Loading draft…" />}>
        <div className="app-route__content">
          <ClassicMode
            onHome={() => navigate('/')}
            onGameUpdates={() => navigate('/updates')}
            onLeaderboard={() => navigate('/leaderboard')}
            registerNavigationBlocker={registerNavigationBlocker}
          />
        </div>
      </Suspense>
    )
  } else if (route === '/leaderboard') {
    screen = (
      <Suspense fallback={<RouteLoading label="Loading leaderboard…" />}>
        <div className="app-route__content"><LeaderboardScreen onHome={() => navigate('/')} onPlay={() => navigate('/draft')} /></div>
      </Suspense>
    )
  } else if (route === '/updates') {
    screen = (
      <Suspense fallback={<RouteLoading label="Loading game updates…" />}>
        <div className="app-route__content"><GameUpdatesScreen onHome={() => navigate('/')} /></div>
      </Suspense>
    )
  } else {
    screen = (
      <div className="app-route__content">
        <HomeScreen
          onPlay={() => navigate('/draft')}
          onLeaderboard={() => navigate('/leaderboard')}
          onGameUpdates={() => navigate('/updates')}
        />
      </div>
    )
  }

  return (
    <div
      className="app-route"
      key={`${route}:${navigationRevision}`}
      ref={routeFocusRef}
      tabIndex={-1}
    >
      {screen}
    </div>
  )
}

export default App

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import HomeScreen from './components/home/HomeScreen'

const ClassicMode = lazy(() => import('./components/draft/ClassicMode'))
const GameUpdatesScreen = lazy(() => import('./components/updates/GameUpdatesScreen'))

type Route = '/' | '/draft' | '/updates'

function RouteLoading({ label }: { label: string }) {
  return (
    <main className="route-loading" aria-label={label} aria-busy="true" aria-live="polite">
      <div>
        <span aria-hidden="true" />
        <p>{label}</p>
      </div>
    </main>
  )
}

function App() {
  const getRoute = (): Route => {
    if (window.location.pathname === '/draft') return '/draft'
    if (window.location.pathname === '/updates') return '/updates'
    return '/'
  }
  const [route, setRoute] = useState<Route>(getRoute)

  useEffect(() => {
    const handlePopState = () => setRoute(getRoute())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = (nextRoute: Route) => {
    if (nextRoute !== route) window.history.pushState({}, '', nextRoute)
    setRoute(nextRoute)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  let screen: ReactNode
  if (route === '/draft') {
    screen = (
      <Suspense fallback={<RouteLoading label="Loading draft…" />}>
        <div className="app-route__content"><ClassicMode onHome={() => navigate('/')} onGameUpdates={() => navigate('/updates')} /></div>
      </Suspense>
    )
  } else if (route === '/updates') {
    screen = (
      <Suspense fallback={<RouteLoading label="Loading game updates…" />}>
        <div className="app-route__content"><GameUpdatesScreen onHome={() => navigate('/')} /></div>
      </Suspense>
    )
  } else {
    screen = <div className="app-route__content"><HomeScreen onPlay={() => navigate('/draft')} onGameUpdates={() => navigate('/updates')} /></div>
  }

  return <div className="app-route" key={route}>{screen}</div>
}

export default App

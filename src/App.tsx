import { lazy, Suspense, useEffect, useState } from 'react'
import HomeScreen from './components/home/HomeScreen'

const ClassicMode = lazy(() => import('./components/draft/ClassicMode'))

type Route = '/' | '/draft'

function App() {
  const getRoute = (): Route => window.location.pathname === '/draft' ? '/draft' : '/'
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

  return route === '/draft'
    ? <Suspense fallback={<main className="route-loading" aria-label="Loading draft" />}><ClassicMode onHome={() => navigate('/')} /></Suspense>
    : <HomeScreen onPlay={() => navigate('/draft')} />
}

export default App

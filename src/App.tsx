import { useEffect, useState } from 'react'
import './App.css'
import Logo162 from './components/Logo162'
import ClassicMode from './components/draft/ClassicMode'

type Route = '/' | '/draft'

function HomePage({ navigate }: { navigate: (route: Route) => void }) {
  return (
    <main className="home-page">
      <div className="home-atmosphere" aria-hidden="true">
        <span className="stadium-light stadium-light--left" />
        <span className="stadium-light stadium-light--right" />
        <span className="home-atmosphere__spotlight" />
        <span className="home-atmosphere__seating" />
        <span className="home-atmosphere__fog" />
        <span className="home-atmosphere__field"><i /></span>
      </div>
      <section className="home-focus shell">
        <div className="home-brand">
          <Logo162 />
          <div className="home-tagline"><span />Build. Draft. Dominate.<span /></div>
          <p>Can you build the<br />greatest baseball team<br />ever assembled?</p>
          <div className="home-divider" aria-hidden="true"><span /></div>
        </div>
        <button className="play-button" type="button" onClick={() => navigate('/draft')}>
          <svg className="play-button__bats" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M6.2 25.8 22.9 9.1c1.7-1.7 2.4-3.5 1.5-4.4-.9-.9-2.7-.2-4.4 1.5L3.3 22.9c-1.1 1.1-1.2 2.5-.3 3.4.8.8 2.2.7 3.2-.5Z" />
            <path d="m4.6 21.8 5.6 5.6M25.8 25.8 9.1 9.1C7.4 7.4 6.7 5.6 7.6 4.7c.9-.9 2.7-.2 4.4 1.5l16.7 16.7c1.1 1.1 1.2 2.5.3 3.4-.8.8-2.2.7-3.2-.5Z" />
            <path d="m27.4 21.8-5.6 5.6" />
          </svg>
          <span>Play Classic</span>
        </button>
      </section>
    </main>
  )
}

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

  return route === '/draft' ? <ClassicMode onHome={() => navigate('/')} /> : <HomePage navigate={navigate} />
}

export default App

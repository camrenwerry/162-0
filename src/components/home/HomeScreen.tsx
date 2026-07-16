import { useCallback, useState } from 'react'
import PennantPursuitLogo from '../PennantPursuitLogo'
import HowToPlayModal from './HowToPlayModal'
import { VERSION_LABEL } from '../../config/app'
import { resetTutorial } from '../../utils/onboarding'
import './HomeScreen.css'

interface HomeScreenProps {
  onPlay: () => void
  onGameUpdates: () => void
}

export default function HomeScreen({ onPlay, onGameUpdates }: HomeScreenProps) {
  const [showHowToPlay, setShowHowToPlay] = useState(false)
  const closeHowToPlay = useCallback(() => setShowHowToPlay(false), [])

  return (
    <main className="dd-home">
      <div className="dd-home__stadium" aria-hidden="true">
        <span className="dd-home__lights dd-home__lights--left" />
        <span className="dd-home__lights dd-home__lights--right" />
        <span className="dd-home__stands" />
        <span className="dd-home__field" />
        <span className="dd-home__plate" />
      </div>
      <section className="dd-home__content">
        <div className="dd-home__brand"><PennantPursuitLogo priority variant="home" /><span>{VERSION_LABEL}</span></div>
        <p>Build the greatest roster in baseball history.</p>
        <div className="dd-home__actions">
          <button className="dd-home__play" type="button" onClick={onPlay}>Play Classic</button>
          <button className="dd-home__how" type="button" onClick={() => setShowHowToPlay(true)}>
            <span aria-hidden="true">ⓘ</span> How to Play
          </button>
          <button className="dd-home__updates" type="button" onClick={onGameUpdates}>Game Updates</button>
        </div>
      </section>
      {showHowToPlay && <HowToPlayModal onClose={closeHowToPlay} onReplayTutorial={() => { resetTutorial(); closeHowToPlay() }} />}
    </main>
  )
}

import DiamondDraftLogo from '../DiamondDraftLogo'
import { GAME_UPDATES } from '../../config/gameUpdates'
import './GameUpdatesScreen.css'

interface GameUpdatesScreenProps {
  onHome: () => void
}

export default function GameUpdatesScreen({ onHome }: GameUpdatesScreenProps) {
  return (
    <main className="game-updates">
      <div className="game-updates__glow" aria-hidden="true" />
      <div className="game-updates__shell">
        <header className="game-updates__header">
          <button type="button" onClick={onHome} aria-label="Back to home">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4-6 6 6 6M7 10h7" /></svg>
            Home
          </button>
          <DiamondDraftLogo compact />
          <p>Game Updates</p>
        </header>

        <div className="game-updates__releases">
          {GAME_UPDATES.map((update) => (
            <article className="game-updates__release" key={update.version}>
              <h1>Version {update.version}</h1>
              <h2>{update.heading}</h2>
              <ul>
                {update.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}

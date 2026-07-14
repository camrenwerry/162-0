import { useState } from 'react'
import { dismissTutorial, isTutorialDismissed } from '../../utils/onboarding'

export default function FirstGameHints() {
  const [visible, setVisible] = useState(() => !isTutorialDismissed())
  if (!visible) return null
  const dismiss = () => { dismissTutorial(); setVisible(false) }
  return (
    <aside className="first-game-hints" aria-label="First game tips">
      <div><strong>Your first draft</strong><span>Tap a player from this franchise and decade, then choose an open roster slot.</span></div>
      <ul><li>Search, sort, or filter the player list anytime.</li><li>Blue positions show where a player can go; grey cards have no open fit.</li><li>You get one Team and one Era reroll for the entire game.</li><li>Fill all 14 slots to project your season.</li></ul>
      <button type="button" onClick={dismiss} aria-label="Dismiss first game tips">Got it</button>
    </aside>
  )
}

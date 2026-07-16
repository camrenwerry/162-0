// Retained through the 1.0 rebrand so existing players keep their tutorial preference.
export const TUTORIAL_DISMISSED_KEY = 'diamond-draft:tutorial-dismissed:v1'

export function isTutorialDismissed(storage: Pick<Storage, 'getItem'> = window.localStorage) {
  try { return storage.getItem(TUTORIAL_DISMISSED_KEY) === 'true' } catch { return false }
}

export function dismissTutorial(storage: Pick<Storage, 'setItem'> = window.localStorage) {
  try { storage.setItem(TUTORIAL_DISMISSED_KEY, 'true') } catch { /* The tutorial still dismisses for this session. */ }
}

export function resetTutorial(storage: Pick<Storage, 'removeItem'> = window.localStorage) {
  try { storage.removeItem(TUTORIAL_DISMISSED_KEY) } catch { /* Storage may be unavailable in privacy mode. */ }
}

import { Component, type ReactNode } from 'react'
import { exportRecovery } from '../storage'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <main className="recovery-page"><span className="section-kicker">HÓVÉGE</span><h1>Nem sikerült megnyitni ezt a nézetet.</h1><p>A mentett adataidat nem töröltük. Tölts le egy helyreállítási másolatot, majd próbáld újra megnyitni az alkalmazást.</p><div className="onboarding-actions"><button className="primary-button" onClick={() => location.reload()}>Újratöltés</button><button className="secondary-button" onClick={exportRecovery}>Helyreállítási másolat</button></div></main>
  }
}

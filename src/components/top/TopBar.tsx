import { useEffect, useState } from 'react'
import { useGame } from '../../game/GameContext'

const ICON_FRAME_SRC =
  'https://www.figma.com/api/mcp/asset/ebdbb393-2ebf-4d61-a7c9-ae4c4a53efd3'
const ICON_SOUND_SRC =
  'https://www.figma.com/api/mcp/asset/47e1628f-f0fc-416d-b2ba-6f445c79268d'
const ICON_SETTINGS_SRC =
  'https://www.figma.com/api/mcp/asset/cfec9819-1993-4c46-a6e9-c97427303104'
const ICON_HISTORY_SRC =
  'https://www.figma.com/api/mcp/asset/b41e7460-d93c-4488-9975-f6afdebbbfee'
const ICON_HELP_SRC =
  'https://www.figma.com/api/mcp/asset/9a22eb69-aa00-4b0b-8f8a-9f5dccd3befb'
const ICON_SUPPORT_SRC =
  'https://www.figma.com/api/mcp/asset/24832b75-e6f2-42fc-a067-3a87a075a6d5'
const ICON_FULLSCREEN_SRC =
  'https://www.figma.com/api/mcp/asset/f2fd693d-9c2a-415b-922f-edfa3b560bc6'
const ICON_INFO_SRC =
  'https://www.figma.com/api/mcp/asset/8f2fb912-9617-4a6e-914f-4dc20693f2b3'
const LOGO_SRC = 'https://www.figma.com/api/mcp/asset/3dda452d-325f-4ba3-860a-5abaee8b420c'
const BACK_ARROW_SRC =
  'https://www.figma.com/api/mcp/asset/f7e31cdb-362f-46d2-a6a7-b3fcd8d10c87'

function formatClock(now: Date): string {
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function TopIcon({
  label,
  iconSrc,
}: {
  label: string
  iconSrc: string
}) {
  return (
    <button type="button" className="top-bar-figma__icon-btn" aria-label={label} title={label}>
      <span className="top-bar-figma__icon-frame" aria-hidden>
        <img src={ICON_FRAME_SRC} alt="" />
      </span>
      <span className="top-bar-figma__icon-glyph" aria-hidden>
        <img src={iconSrc} alt="" />
      </span>
    </button>
  )
}

export function TopBar() {
  const { state } = useGame()
  const [clock, setClock] = useState(() => formatClock(new Date()))

  useEffect(() => {
    const timer = window.setInterval(() => setClock(formatClock(new Date())), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <header className="top-bar top-bar-figma">
      <div className="top-bar-figma__left">
        <div className="top-bar-figma__name-wrap">
          <button
            type="button"
            className="top-bar-figma__back-btn"
            aria-label="Back to lobby"
            title="Back to lobby"
          >
            <img src={BACK_ARROW_SRC} alt="" />
          </button>
          <span className="top-bar-figma__name">SUZHOU GARDEN SICBO</span>
        </div>

        <span className="top-bar-figma__meta">{state.limitsLabel}</span>
        <TopIcon label="Paytable" iconSrc={ICON_INFO_SRC} />
        <span className="top-bar-figma__divider" aria-hidden />
        <span className="top-bar-figma__meta">
          {clock} ID:{state.gameId}
        </span>
      </div>

      <div className="top-bar-figma__center">
        <a
          href="/dev/grid-builder"
          target="_blank"
          rel="noopener noreferrer"
          className="top-bar-figma__logo-wrap"
          aria-label="Open Grid Builder"
          title="Open Grid Builder"
        >
          <img src={LOGO_SRC} alt="CRYSTAL" className="top-bar-figma__logo" />
        </a>
      </div>

      <div className="top-bar-figma__right">
        <TopIcon label="Sound" iconSrc={ICON_SOUND_SRC} />
        <TopIcon label="Settings" iconSrc={ICON_SETTINGS_SRC} />
        <TopIcon label="History" iconSrc={ICON_HISTORY_SRC} />
        <TopIcon label="Help" iconSrc={ICON_HELP_SRC} />
        <TopIcon label="Support" iconSrc={ICON_SUPPORT_SRC} />
        <TopIcon label="Fullscreen" iconSrc={ICON_FULLSCREEN_SRC} />
      </div>
    </header>
  )
}

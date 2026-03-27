import { CHIP_VALUES } from '../../game/defaults'
import { useBettingOpen, useGame } from '../../game/GameContext'
import type { ChipValue } from '../../game/types'
import {
  CHIP_LOCAL_SRC,
  CHIP_NOMINALS,
  type ChipNominal,
  chipSourceCandidates,
  chipNominalFromValue,
} from '../../game/chips'

const ICON_UNDO_SRC =
  'https://www.figma.com/api/mcp/asset/24193fc9-fb7f-41f5-a630-34255a5f1564'
const ICON_REPEAT_SRC =
  'https://www.figma.com/api/mcp/asset/3455566d-1dd6-401d-a458-aacdaefa2098'
const ICON_AUTOPLAY_SRC =
  'https://www.figma.com/api/mcp/asset/75f4f83a-1eaf-4960-b6cc-8d6635bd1611'
const ICON_LOBBY_SRC =
  'https://www.figma.com/api/mcp/asset/e9974cb2-06c6-4aed-956d-00e0e158bf28'

function formatFigmaMoney(value: number): string {
  return `$ ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function ChipButton({
  nominal,
  selected,
  disabled,
  onClick,
}: {
  nominal: ChipNominal
  selected: boolean
  disabled: boolean
  onClick: () => void
}) {
  const localSrc = CHIP_LOCAL_SRC[nominal]
  const candidates = chipSourceCandidates(nominal)

  return (
    <button
      type="button"
      className={`bottom-bar-figma__chip ${selected ? 'is-selected' : ''}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={`Chip ${nominal}`}
      aria-pressed={selected}
    >
      <span className="bottom-bar-figma__chip-art" aria-hidden>
        <img
          src={localSrc}
          alt={`Chip ${nominal}`}
          loading="eager"
          draggable={false}
          onError={(e) => {
            const img = e.currentTarget
            const currentIdx = Number(img.dataset.srcIdx ?? '0')
            const nextIdx = currentIdx + 1
            if (nextIdx >= candidates.length) return
            img.dataset.srcIdx = String(nextIdx)
            img.src = candidates[nextIdx]
          }}
        />
      </span>
    </button>
  )
}

function UtilityIcon({
  label,
  iconSrc,
  onClick,
  disabled,
}: {
  label: string
  iconSrc: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="bottom-bar-figma__utility"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <img src={iconSrc} alt="" />
    </button>
  )
}

export function BottomBar() {
  const { state, dispatch } = useGame()
  const open = useBettingOpen()
  const selectable = new Set(CHIP_VALUES.map((v) => chipNominalFromValue(v)))

  return (
    <footer className="bottom-bar bottom-bar-figma">
      <div className="bottom-bar-figma__money">
        <div className="bottom-bar-figma__money-col">
          <span className="bottom-bar-figma__caption">BALANCE:</span>
          <span className="bottom-bar-figma__amount">{formatFigmaMoney(state.balance)}</span>
        </div>
        <span className="bottom-bar-figma__vr" aria-hidden />
        <div className="bottom-bar-figma__money-col">
          <span className="bottom-bar-figma__caption">TOTAL BET:</span>
          <span className="bottom-bar-figma__amount is-gold">
            {formatFigmaMoney(state.totalBet)}
          </span>
        </div>
      </div>

      <div className="bottom-bar-figma__center">
        <UtilityIcon
          label="Undo"
          iconSrc={ICON_UNDO_SRC}
          disabled={!open || state.betStack.length === 0}
          onClick={() => dispatch({ type: 'UNDO_LAST' })}
        />
        <div className="bottom-bar-figma__chips" role="group" aria-label="Chip value">
          {CHIP_NOMINALS.map((nominal) => {
            const numericValue =
              nominal === '1K'
                ? 1000
                : nominal === '2K'
                  ? 2000
                  : nominal === '5K'
                    ? 5000
                    : Number(nominal)

            const isSelectable = selectable.has(nominal)
            const disabled = !open || !isSelectable || numericValue > state.balance

            return (
              <ChipButton
                key={nominal}
                nominal={nominal}
                selected={isSelectable && state.selectedChip === numericValue}
                disabled={disabled}
                onClick={() => {
                  if (!isSelectable) return
                  dispatch({ type: 'SET_SELECTED_CHIP', value: numericValue as ChipValue })
                }}
              />
            )
          })}
        </div>
        <UtilityIcon
          label="Repeat"
          iconSrc={ICON_REPEAT_SRC}
          disabled={!open || state.totalBet <= 0}
          onClick={() => dispatch({ type: 'CLEAR_BETS' })}
        />
      </div>

      <div className="bottom-bar-figma__actions">
        <button type="button" className="bottom-bar-figma__pill" disabled>
          <img src={ICON_AUTOPLAY_SRC} alt="" aria-hidden />
          <span>AUTOPLAY</span>
        </button>
        <span className="bottom-bar-figma__vr tall" aria-hidden />
        <button type="button" className="bottom-bar-figma__pill lobby" disabled>
          <img src={ICON_LOBBY_SRC} alt="" aria-hidden />
          <span>LOBBY</span>
        </button>
      </div>
    </footer>
  )
}

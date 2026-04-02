/**
 * `/dev/grid-editor` previously hosted a standalone zone editor that did not share state with the canvas builder.
 * Zones are configured on layers in the Grid Builder (`/dev/grid-builder`).
 */
export function LegacyGridZoneEditorNotice() {
  return (
    <div
      className="legacy-grid-editor-notice"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        color: '#e8eef8',
        background: '#0b0f14',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 480 }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 12 }}>
          Legacy zone editor retired
        </h1>
        <p style={{ marginBottom: 24, lineHeight: 1.55, opacity: 0.92 }}>
          Betting zones are edited together with layers and animations in the Grid Builder. The old page only adjusted
          default zone rectangles and could drift from your published grid package.
        </p>
        <a href="/dev/grid-builder" style={{ color: '#8ec5ff', fontWeight: 500 }}>
          Open Grid Builder
        </a>
      </div>
    </div>
  )
}

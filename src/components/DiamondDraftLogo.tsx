import './DiamondDraftLogo.css'

export interface DiamondDraftLogoProps {
  className?: string
  compact?: boolean
}

export default function DiamondDraftLogo({ className, compact = false }: DiamondDraftLogoProps) {
  return (
    <div
      className={`diamond-draft-logo${compact ? ' diamond-draft-logo--compact' : ''}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label="Diamond Draft"
    >
      <span className="diamond-draft-logo__crest" aria-hidden="true">
        <i className="diamond-draft-logo__baseball" />
        <i className="diamond-draft-logo__star">★</i>
      </span>
      <span className="diamond-draft-logo__words">
        <strong data-text="Diamond">Diamond</strong>
        <b data-text="Draft">Draft</b>
      </span>
    </div>
  )
}

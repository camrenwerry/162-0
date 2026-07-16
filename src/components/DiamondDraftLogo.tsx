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
        <svg className="diamond-draft-logo__baseball" viewBox="0 0 64 64" focusable="false">
          <circle cx="32" cy="32" r="29" fill="#fff" stroke="#b8b5ae" strokeWidth="2.5" />
          <g fill="none" stroke="#b4232d" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 8C35 17 35 47 16 56M48 8C29 17 29 47 48 56" strokeWidth="2.75" />
            <path d="m19 14 5-4m-.5 10 6-4m-3.5 9 7-1m-7 8h7m-8.5 7 6 4m-11 4 5.5 5M45 10l5 4m-15.5 2 6 4M31 24l7 1m-7 7h7m-4.5 11 6-4M39 52l5.5-5" strokeWidth="2.1" />
          </g>
        </svg>
        <i className="diamond-draft-logo__star">★</i>
      </span>
      <span className="diamond-draft-logo__words">
        <strong data-text="Diamond">Diamond</strong>
        <b data-text="Draft">Draft</b>
      </span>
    </div>
  )
}

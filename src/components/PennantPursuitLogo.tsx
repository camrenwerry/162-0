import './PennantPursuitLogo.css'

export interface PennantPursuitLogoProps {
  className?: string
  compact?: boolean
  priority?: boolean
  variant?: 'dark' | 'home' | 'light' | 'transparent'
}

export default function PennantPursuitLogo({ className, compact = false, priority = false, variant = 'dark' }: PennantPursuitLogoProps) {
  const isHome = !compact && variant === 'home'
  const source = compact
    ? '/branding/pennant-pursuit-logo-compact.webp'
    : isHome
      ? '/branding/pennant-pursuit-logo-home.webp'
      : variant === 'light'
        ? '/branding/pennant-pursuit-logo-light.webp'
        : variant === 'transparent'
          ? '/branding/pennant-pursuit-logo.png'
          : '/branding/pennant-pursuit-logo-dark.webp'

  return (
    <img
      className={`pennant-pursuit-logo${compact ? ' pennant-pursuit-logo--compact' : ''}${isHome ? ' pennant-pursuit-logo--home' : ''}${className ? ` ${className}` : ''}`}
      src={source}
      width={compact ? 672 : isHome ? 689 : 704}
      height={compact ? 520 : isHome ? 542 : 560}
      alt="Pennant Pursuit"
      decoding={priority ? 'sync' : 'async'}
      fetchPriority={priority ? 'high' : undefined}
      loading={priority ? 'eager' : undefined}
      draggable="false"
    />
  )
}

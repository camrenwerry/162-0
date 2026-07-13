import './Logo162.css'

export interface Logo162Props {
  className?: string
}

export default function Logo162({ className }: Logo162Props) {
  return (
    <div className={className ? `logo-162 ${className}` : 'logo-162'} role="img" aria-label="162-0">
      <span className="logo-162__numbers" data-text="162">162</span>
      <span className="logo-162__dash" aria-hidden="true" />
      <span className="logo-162__zero" data-text="0">0</span>
    </div>
  )
}

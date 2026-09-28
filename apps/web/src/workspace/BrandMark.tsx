/**
 * The Opsis mark. Opsis (ὄψις) is Greek for sight, and Aristotle's word for spectacle: an eye
 * drawn as a diagram, with its lids as connections, its corners as ports and a node for a pupil.
 * Keep in step with public/favicon.svg.
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#2d5445" />
      <g fill="none" strokeLinecap="round" strokeWidth={3.6}>
        <path d="M9 33 C 16.22 17.76, 34.37 14.74, 46.95 23.95" stroke="#f7faf3" />
        <path d="M55 33 C 44 52, 18 52, 9 33" stroke="#f7faf3" strokeOpacity={0.55} />
      </g>
      <path
        d="M52.65 29.51 L 43.74 27.24 L 50.16 20.66 Z"
        fill="#f7faf3"
        stroke="#f7faf3"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <circle cx="32" cy="33" r="8.8" fill="#f4dcaa" />
      <circle cx="32" cy="33" r="3.2" fill="#2d5445" />
      <circle cx="9" cy="33" r="3.6" fill="#f4dcaa" />
      <circle cx="55" cy="33" r="3.6" fill="#f4dcaa" />
    </svg>
  );
}

import { useEffect, useRef, useState } from 'react'
import goddessPoster from '../assets/goddess.webp'
import goddessVideo from '../assets/goddess.webm'

/**
 * The parchment's one piece of art: Gabija, the fire goddess (the site's
 * tos-1), standing at the right edge and cropped at the bottom by a soft
 * mask, with a warm pool of light behind her so she sits in the parchment
 * rather than on it. No scrim, no card. In the News and Settings views she
 * steps aside to the right, so the wider column there has the room.
 *
 * She moves: a short idle animation (hair, flame, a blink) as a VP9 WebM
 * with an alpha channel, played back and forth so the loop has no seam.
 * The poster is its first frame, so nothing jumps when the video takes
 * over; the same frame stands in for the video when the system asks for
 * less motion. The video pauses while the window is hidden (minimised, or
 * behind the game) and resumes when it comes back.
 */
export function Backdrop({ aside }: { aside: boolean }) {
  const reducedMotion = usePrefersReducedMotion()
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className={`absolute inset-0 transition-transform duration-500 ease-out motion-reduce:transition-none ${aside ? 'translate-x-40' : ''}`}
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_520px_460px_at_78%_62%,rgba(255,214,150,0.45),rgba(255,214,150,0)_70%)]" />
        {reducedMotion ? (
          <img src={goddessPoster} alt="" width={1440} height={1440} className={artClass} />
        ) : (
          <GoddessVideo />
        )}
      </div>
    </div>
  )
}

const artClass = 'absolute -bottom-[60px] right-4 h-[660px] w-auto max-w-none mask-b-from-62% mask-b-to-96%'

function GoddessVideo() {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const sync = () => {
      if (document.hidden) video.pause()
      else void video.play().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])
  return (
    <video
      ref={ref}
      src={goddessVideo}
      poster={goddessPoster}
      width={1440}
      height={1440}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      disableRemotePlayback
      className={artClass}
    />
  )
}

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(reducedMotionQuery).matches)
  useEffect(() => {
    const query = window.matchMedia(reducedMotionQuery)
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

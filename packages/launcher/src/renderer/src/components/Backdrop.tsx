import goddessUrl from '../assets/goddess.webp'

/**
 * The parchment's one piece of art: Gabija, the fire goddess (the site's
 * tos-1), standing at the right edge and cropped at the bottom by a soft
 * mask, with a warm pool of light behind her so she sits in the parchment
 * rather than on it. No scrim, no card. In the News and Settings views she
 * steps aside to the right, so the wider column there has the room.
 */
export function Backdrop({ aside }: { aside: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className={`absolute inset-0 transition-transform duration-500 ease-out motion-reduce:transition-none ${aside ? 'translate-x-40' : ''}`}
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_520px_460px_at_78%_62%,rgba(255,214,150,0.45),rgba(255,214,150,0)_70%)]" />
        <img
          src={goddessUrl}
          alt=""
          width={560}
          height={560}
          className="absolute -bottom-[60px] right-4 h-[660px] w-auto max-w-none mask-b-from-62% mask-b-to-96%"
        />
      </div>
    </div>
  )
}

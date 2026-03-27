/**
 * Game frame background with two display modes:
 *   "image"  — static image from VITE_STREAM_IMAGE (or fallback gradient)
 *   "stream" — YouTube embed (VITE_STREAM_YOUTUBE_URL) or direct video (VITE_STREAM_URL)
 */

export type StreamMode = 'image' | 'stream'

type StreamBackgroundProps = {
  mode?: StreamMode
}

export function StreamBackground({ mode = 'image' }: StreamBackgroundProps) {
  const youtubeUrl = import.meta.env.VITE_STREAM_YOUTUBE_URL ?? ''
  const videoSrc = import.meta.env.VITE_STREAM_URL
  const imageSrc = import.meta.env.VITE_STREAM_IMAGE

  const youtubeVideoId = extractYoutubeVideoId(youtubeUrl)
  const youtubeEmbedSrc = youtubeVideoId
    ? `https://www.youtube.com/embed/${youtubeVideoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${youtubeVideoId}&playsinline=1&rel=0&modestbranding=1`
    : null

  const showStream = mode === 'stream'
  const showImage = mode === 'image'

  return (
    <div className="stream-bg" aria-hidden>
      {showStream && youtubeEmbedSrc ? (
        <iframe
          className="stream-bg__media stream-bg__media--youtube"
          src={youtubeEmbedSrc}
          title="Background YouTube stream"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : null}
      {showStream && !youtubeEmbedSrc && videoSrc ? (
        <video
          className="stream-bg__media"
          src={videoSrc}
          autoPlay
          muted
          playsInline
          loop
        />
      ) : null}
      {showImage && imageSrc ? (
        <img className="stream-bg__media stream-bg__media--image" src={imageSrc} alt="" />
      ) : null}
      {showImage && !imageSrc ? <div className="stream-bg__fallback" /> : null}
      {showStream && !youtubeEmbedSrc && !videoSrc ? <div className="stream-bg__fallback" /> : null}
      <div className="stream-bg__overlay" />
    </div>
  )
}

function extractYoutubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      return parsed.pathname.slice(1) || null
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (parsed.pathname === '/watch') {
        return parsed.searchParams.get('v')
      }
      if (parsed.pathname.startsWith('/embed/')) {
        return parsed.pathname.split('/')[2] || null
      }
    }
  } catch {
    return null
  }
  return null
}

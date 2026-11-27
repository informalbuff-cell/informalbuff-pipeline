import React from 'react'
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

export type Story = {
  title: string
  line: string
  image: string
  wash?: string
}

export type ReelProps = {
  hook: string
  kicker: string
  stories: Story[]
  audio: string | null
  handle: string
  site: string
  style?: 'poster' | 'split'
}

const INK = '#0b0b10'
const PAPER = '#fbf9f4'
const YELLOW = '#f4e75c'
const WASH = ['#d3f3c8', '#cfe9f7', '#ffd9e2']

/** Seconds each story holds. Long enough to read, short enough to keep pace. */
const STORY_FRAMES = 240
const HOOK_FRAMES = 90
const CTA_FRAMES = 90

function usePop(delay = 0) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 180 } })
  return {
    opacity: interpolate(s, [0, 1], [0, 1], { extrapolateRight: 'clamp' }),
    transform: `translateY(${interpolate(s, [0, 1], [40, 0])}px) scale(${interpolate(
      s,
      [0, 1],
      [0.96, 1],
    )})`,
  }
}

const Chip: React.FC<{ children: React.ReactNode; bg?: string }> = ({ children, bg = YELLOW }) => (
  <span
    style={{
      display: 'inline-block',
      background: bg,
      color: INK,
      border: `4px solid ${INK}`,
      padding: '10px 22px',
      fontSize: 34,
      fontWeight: 900,
      letterSpacing: 2,
      textTransform: 'uppercase',
    }}
  >
    {children}
  </span>
)

const Hook: React.FC<{ hook: string; kicker: string }> = ({ hook, kicker }) => {
  const pop = usePop(0)
  const sub = usePop(8)
  return (
    <AbsoluteFill style={{ background: YELLOW, padding: 90, justifyContent: 'center' }}>
      <div style={sub}>
        <Chip bg={PAPER}>{kicker}</Chip>
      </div>
      <div
        style={{
          ...pop,
          marginTop: 40,
          fontSize: 104,
          lineHeight: 1.02,
          fontWeight: 900,
          color: INK,
          textTransform: 'uppercase',
          letterSpacing: -2,
        }}
      >
        {hook}
      </div>
      <div style={{ ...sub, marginTop: 48, fontSize: 40, fontWeight: 700, color: INK, opacity: 0.7 }}>
        Watch to the end →
      </div>
    </AbsoluteFill>
  )
}

const StoryCard: React.FC<{ story: Story; index: number; split?: boolean }> = ({ story, index, split }) => {
  const frame = useCurrentFrame()

  // Split cards already contain the headline, facts and branding, so they fill
  // the frame on their own — no wash, no chip, no extra title.
  if (split && story.image) {
    const push = interpolate(frame, [0, STORY_FRAMES], [1, 1.05], { extrapolateRight: 'clamp' })
    const fade = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' })
    return (
      <AbsoluteFill style={{ background: INK, opacity: fade }}>
        <Img
          src={story.image.startsWith('http') ? story.image : staticFile(story.image)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${push})` }}
        />
      </AbsoluteFill>
    )
  }

  const wash = story.wash || WASH[index % WASH.length]
  const title = fitTitle(story.title)
  // A slow drift keeps the frame alive without making text harder to read.
  const drift = interpolate(frame, [0, STORY_FRAMES], [0, -18], { extrapolateRight: 'clamp' })
  const pop = usePop(4)
  const posterIn = usePop(12)

  return (
    <AbsoluteFill style={{ background: wash, padding: 60, paddingTop: 120, paddingBottom: 240 }}>
      <div style={{ ...pop }}>
        <Chip>{`Story ${index + 1}`}</Chip>
        <div
          style={{
            marginTop: 24,
            fontSize: title.size,
            lineHeight: 1.05,
            fontWeight: 900,
            color: INK,
            textTransform: 'uppercase',
            letterSpacing: -1,
          }}
        >
          {title.text}
        </div>
      </div>

      <div
        style={{
          ...posterIn,
          flex: 1,
          marginTop: 34,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `${posterIn.transform} translateY(${drift}px)`,
        }}
      >
        {story.image ? (
          split ? (
            /* The split card already carries the headline and facts, so it fills
               the frame with a slow push instead of sitting inside a border. */
            <Img
              src={story.image.startsWith('http') ? story.image : staticFile(story.image)}
              style={{
                width: '100%',
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                transform: `scale(${interpolate(frame, [0, STORY_FRAMES], [1, 1.06], {
                  extrapolateRight: 'clamp',
                })})`,
              }}
            />
          ) : (
            <Img
              src={story.image.startsWith('http') ? story.image : staticFile(story.image)}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                border: `5px solid ${INK}`,
                boxShadow: `12px 12px 0 ${INK}`,
                background: PAPER,
              }}
            />
          )
        ) : null}
      </div>

      {story.line && !split ? (
        <div
          style={{
            marginTop: 28,
            fontSize: 34,
            lineHeight: 1.3,
            fontWeight: 700,
            color: INK,
            opacity: 0.85,
            maxHeight: 140,
            overflow: 'hidden',
          }}
        >
          {story.line}
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

const CallToAction: React.FC<{ handle: string; site: string }> = ({ handle, site }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const pulse = 1 + 0.03 * Math.sin((frame / fps) * Math.PI * 2)
  const pop = usePop(0)
  const second = usePop(10)

  return (
    <AbsoluteFill
      style={{ background: INK, padding: 90, justifyContent: 'center', alignItems: 'center' }}
    >
      <div style={{ ...pop, transform: `${pop.transform} scale(${pulse})` }}>
        <div
          style={{
            fontSize: 92,
            fontWeight: 900,
            color: YELLOW,
            textTransform: 'uppercase',
            textAlign: 'center',
            lineHeight: 1.02,
          }}
        >
          Follow for the next brief
        </div>
      </div>
      <div
        style={{
          ...second,
          marginTop: 44,
          fontSize: 54,
          fontWeight: 900,
          color: PAPER,
          textAlign: 'center',
        }}
      >
        {handle}
      </div>
      <div style={{ ...second, marginTop: 16, fontSize: 34, color: PAPER, opacity: 0.6 }}>{site}</div>
    </AbsoluteFill>
  )
}

/** Thin retention bar: viewers see progress and stay for the ending. */
const Progress: React.FC<{ total: number }> = ({ total }) => {
  const frame = useCurrentFrame()
  const pct = Math.min(1, frame / total)
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 10, zIndex: 40 }}>
      <div style={{ width: `${pct * 100}%`, height: '100%', background: YELLOW }} />
    </div>
  )
}

/** Long headlines were clipping mid-line at 62px; scale down and cut cleanly. */
function fitTitle(title: string) {
  const clean = (title || '').replace(/\s+/g, ' ').trim()
  const cut = clean.length > 96 ? `${clean.slice(0, 93).trimEnd()}…` : clean
  return { text: cut, size: cut.length > 70 ? 46 : cut.length > 52 ? 52 : 62 }
}

export const Reel: React.FC<ReelProps> = ({ hook, kicker, stories, audio, handle, site, style }) => {
  const { durationInFrames } = useVideoConfig()
  const shown = stories.slice(0, 3)

  return (
    <AbsoluteFill style={{ background: INK, fontFamily: 'Inter, Helvetica, Arial, sans-serif' }}>
      {audio ? <Audio src={staticFile(audio)} /> : null}
      <Progress total={durationInFrames} />

      <Sequence from={0} durationInFrames={HOOK_FRAMES}>
        <Hook hook={hook} kicker={kicker} />
      </Sequence>

      {shown.map((story, i) => (
        <Sequence
          key={`${story.title}-${i}`}
          from={HOOK_FRAMES + i * STORY_FRAMES}
          durationInFrames={STORY_FRAMES}
        >
          <StoryCard story={story} index={i} split={style === 'split'} />
        </Sequence>
      ))}

      <Sequence from={HOOK_FRAMES + shown.length * STORY_FRAMES} durationInFrames={CTA_FRAMES}>
        <CallToAction handle={handle} site={site} />
      </Sequence>
    </AbsoluteFill>
  )
}

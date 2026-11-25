import { Composition, registerRoot } from 'remotion'
import { Reel, type ReelProps } from './Reel'

/**
 * 30 seconds at 30fps = 900 frames. Vertical only: reels are watched at
 * 1080x1920 and anything else gets letterboxed by Instagram.
 */
const FPS = 30
const DURATION_SECONDS = 30

const defaultProps: ReelProps = {
  hook: 'The story nobody explained properly',
  kicker: 'InformalBuff',
  stories: [
    { title: 'Story one', line: 'One line of context', image: '' },
    { title: 'Story two', line: 'One line of context', image: '' },
    { title: 'Story three', line: 'One line of context', image: '' },
  ],
  audio: null,
  handle: '@informal.buff',
  site: 'informalbuff.vercel.app',
}

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Reel"
      component={Reel}
      durationInFrames={FPS * DURATION_SECONDS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
    />
  )
}

registerRoot(RemotionRoot)

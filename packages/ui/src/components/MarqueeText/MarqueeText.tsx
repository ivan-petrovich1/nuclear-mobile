import {
  CSSProperties,
  FC,
  MouseEventHandler,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { cn } from '../../utils';

const OVERFLOW_THRESHOLD_PX = 2;
const DEFAULT_SPEED_PX_PER_SEC = 32;
const ACTIVE_TRAVEL_RATIO = 0.34;
const MIN_DURATION_SEC = 6;
const MAX_DURATION_SEC = 28;
const MAX_EDGE_FADE_PAD_PX = 16;
const EDGE_FADE_WIDTH_RATIO = 0.15;

type MarqueeElement = 'div' | 'span' | 'h1' | 'h2' | 'h3' | 'p';

type MarqueeCSSProperties = CSSProperties & {
  '--marquee-distance'?: string;
  '--marquee-duration'?: string;
};

export type MarqueeTextProps = {
  children: string;
  as?: MarqueeElement;
  className?: string;
  speedPxPerSec?: number;
  title?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  'data-testid'?: string;
};

type MarqueeMetrics = {
  scrollDistance: number;
  durationSec: number;
};

export const calculateMarqueeMetrics = (
  containerWidth: number,
  contentWidth: number,
  speedPxPerSec = DEFAULT_SPEED_PX_PER_SEC,
): MarqueeMetrics => {
  const rawOverflow = Math.ceil(contentWidth - containerWidth);
  if (containerWidth <= 0 || rawOverflow <= OVERFLOW_THRESHOLD_PX) {
    return { scrollDistance: 0, durationSec: 0 };
  }

  const edgePad = Math.min(
    MAX_EDGE_FADE_PAD_PX,
    Math.floor(containerWidth * EDGE_FADE_WIDTH_RATIO),
  );
  const scrollDistance = rawOverflow + edgePad;
  const safeSpeed =
    speedPxPerSec > 0 ? speedPxPerSec : DEFAULT_SPEED_PX_PER_SEC;
  const rawDuration = scrollDistance / (safeSpeed * ACTIVE_TRAVEL_RATIO);
  const durationSec = Math.min(
    MAX_DURATION_SEC,
    Math.max(MIN_DURATION_SEC, Number(rawDuration.toFixed(2))),
  );

  return { scrollDistance, durationSec };
};

export const MarqueeText: FC<MarqueeTextProps> = ({
  children,
  as = 'div',
  className,
  speedPxPerSec = DEFAULT_SPEED_PX_PER_SEC,
  title,
  onClick,
  'data-testid': dataTestId,
}) => {
  const containerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLSpanElement | null>(null);
  const [metrics, setMetrics] = useState<MarqueeMetrics>({
    scrollDistance: 0,
    durationSec: 0,
  });

  const setContainerRef = useCallback((node: HTMLElement | null) => {
    containerRef.current = node;
  }, []);

  useLayoutEffect(() => {
    let isCancelled = false;

    const measure = () => {
      const container = containerRef.current;
      const content = contentRef.current;
      if (!container || !content) {
        return;
      }

      const nextMetrics = calculateMarqueeMetrics(
        container.clientWidth,
        content.scrollWidth,
        speedPxPerSec,
      );

      setMetrics((prevMetrics) => {
        if (
          prevMetrics.scrollDistance === nextMetrics.scrollDistance &&
          prevMetrics.durationSec === nextMetrics.durationSec
        ) {
          return prevMetrics;
        }
        return nextMetrics;
      });
    };

    measure();

    const container = containerRef.current;
    const content = contentRef.current;
    let observer: ResizeObserver | undefined;

    if (typeof ResizeObserver !== 'undefined' && container && content) {
      observer = new ResizeObserver(measure);
      observer.observe(container);
      observer.observe(content);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure);
    }

    const fontSet =
      typeof document !== 'undefined' ? document.fonts : undefined;
    if (fontSet?.ready) {
      void fontSet.ready.then(() => {
        if (!isCancelled) {
          measure();
        }
      });
    }

    return () => {
      isCancelled = true;
      if (observer) {
        observer.disconnect();
      } else if (typeof window !== 'undefined') {
        window.removeEventListener('resize', measure);
      }
    };
  }, [as, children, speedPxPerSec]);

  const Component = as;
  const isOverflowing = metrics.scrollDistance > 0;
  const marqueeStyle: MarqueeCSSProperties | undefined = isOverflowing
    ? {
        '--marquee-distance': `-${metrics.scrollDistance}px`,
        '--marquee-duration': `${metrics.durationSec}s`,
      }
    : undefined;

  return (
    <Component
      ref={setContainerRef}
      data-testid={dataTestId}
      data-overflowing={isOverflowing ? 'true' : undefined}
      title={title ?? (isOverflowing ? children : undefined)}
      onClick={onClick}
      className={cn(
        'nuclear-marquee-container block max-w-full min-w-0 overflow-hidden whitespace-nowrap',
        isOverflowing && 'nuclear-marquee-mask text-left',
        className,
      )}
    >
      <span
        key={children}
        ref={contentRef}
        data-marquee-content=""
        className={cn(
          'nuclear-marquee-content inline-block whitespace-nowrap',
          isOverflowing && 'nuclear-marquee-animate',
        )}
        style={marqueeStyle}
      >
        {children}
      </span>
    </Component>
  );
};

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculateMarqueeMetrics, MarqueeText } from './MarqueeText';

const originalResizeObserver = globalThis.ResizeObserver;
const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'clientWidth',
);
const originalScrollWidthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollWidth',
);

type WidthConfig = {
  containerWidth: number;
  contentWidth: number;
};

const installWidthAndResizeMock = (widths: WidthConfig) => {
  const callbacks = new Set<ResizeObserverCallback>();

  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      if (this.hasAttribute('data-testid')) {
        return widths.containerWidth;
      }
      return 0;
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      if (this.hasAttribute('data-marquee-content')) {
        return widths.contentWidth;
      }
      return 0;
    },
  });

  class TestResizeObserver {
    private callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      callbacks.add(callback);
    }

    observe(): void {}

    unobserve(): void {}

    disconnect(): void {
      callbacks.delete(this.callback);
    }
  }

  (
    globalThis as {
      ResizeObserver?: typeof ResizeObserver;
    }
  ).ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

  return {
    triggerResize(nextWidths: WidthConfig) {
      widths.containerWidth = nextWidths.containerWidth;
      widths.contentWidth = nextWidths.contentWidth;
      for (const callback of callbacks) {
        callback([], {} as ResizeObserver);
      }
    },
  };
};

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;

  if (originalClientWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'clientWidth',
      originalClientWidthDescriptor,
    );
  } else {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  }

  if (originalScrollWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollWidth',
      originalScrollWidthDescriptor,
    );
  } else {
    delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
  }
});

describe('calculateMarqueeMetrics', () => {
  it('returns zero scroll distance when container width is zero or text fits', () => {
    expect(calculateMarqueeMetrics(0, 200)).toEqual({
      scrollDistance: 0,
      durationSec: 0,
    });
    expect(calculateMarqueeMetrics(200, 140)).toEqual({
      scrollDistance: 0,
      durationSec: 0,
    });
    expect(calculateMarqueeMetrics(200, 202)).toEqual({
      scrollDistance: 0,
      durationSec: 0,
    });
  });

  it('adds capped edge padding and clamps duration within bounds', () => {
    expect(calculateMarqueeMetrics(160, 320)).toEqual({
      scrollDistance: 176,
      durationSec: 16.18,
    });
    expect(calculateMarqueeMetrics(80, 90)).toEqual({
      scrollDistance: 22,
      durationSec: 6,
    });
    expect(calculateMarqueeMetrics(160, 1000)).toEqual({
      scrollDistance: 856,
      durationSec: 28,
    });
    expect(calculateMarqueeMetrics(160, 320, 0)).toEqual({
      scrollDistance: 176,
      durationSec: 16.18,
    });
  });
});

describe('MarqueeText', () => {
  it('(Snapshot) renders default div cleanly', () => {
    const { container } = render(
      <MarqueeText data-testid="marquee-title">Short Song Title</MarqueeText>,
    );
    expect(container).toMatchSnapshot();
  });

  it('(Snapshot) renders heading element when as="h2"', () => {
    const { container } = render(
      <MarqueeText as="h2" className="text-xl font-bold" data-testid="heading">
        Heading Song Title
      </MarqueeText>,
    );
    expect(container).toMatchSnapshot();
  });

  it('renders a single text node without duplicating DOM text', () => {
    const text = 'A Very Long Track Title That Would Overflow';
    installWidthAndResizeMock({ containerWidth: 160, contentWidth: 320 });

    render(<MarqueeText data-testid="marquee-title">{text}</MarqueeText>);

    const container = screen.getByTestId('marquee-title');
    const matches = screen.getAllByText(text);
    expect(matches).toHaveLength(1);
    expect(container.textContent).toBe(text);
  });

  it('does not animate when the title fits or is within the subpixel threshold', () => {
    const widths = { containerWidth: 200, contentWidth: 140 };
    const observer = installWidthAndResizeMock(widths);

    render(
      <MarqueeText data-testid="marquee-title">Fitting Track</MarqueeText>,
    );

    const container = screen.getByTestId('marquee-title');
    const content = screen.getByText('Fitting Track');

    expect(container).not.toHaveAttribute('data-overflowing');
    expect(container).not.toHaveAttribute('title');
    expect(container).not.toHaveClass('nuclear-marquee-mask');
    expect(content).not.toHaveClass('nuclear-marquee-animate');

    act(() => {
      observer.triggerResize({ containerWidth: 200, contentWidth: 202 });
    });

    expect(container).not.toHaveAttribute('data-overflowing');
    expect(content).not.toHaveClass('nuclear-marquee-animate');
  });

  it('activates marquee classes, title tooltip, and CSS variables when overflowing', () => {
    const longTitle =
      'An Incredibly Long Song Title That Exceeds Available Width';
    installWidthAndResizeMock({ containerWidth: 160, contentWidth: 320 });

    render(<MarqueeText data-testid="marquee-title">{longTitle}</MarqueeText>);

    const container = screen.getByTestId('marquee-title');
    const content = screen.getByText(longTitle);

    expect(container).toHaveAttribute('data-overflowing', 'true');
    expect(container).toHaveAttribute('title', longTitle);
    expect(container).toHaveClass('nuclear-marquee-mask', 'text-left');
    expect(content).toHaveClass('nuclear-marquee-animate');
    expect(content.style.getPropertyValue('--marquee-distance')).toBe('-176px');
    expect(content.style.getPropertyValue('--marquee-duration')).toBe('16.18s');
  });

  it('stops scrolling when container resizes wider or title shortens, and updates between long titles', () => {
    const firstLongTitle = 'First Long Song Title That Needs Scrolling';
    const secondLongTitle = 'Second Even Longer Song Title With Extra Words';
    const shortTitle = 'Short';
    const widths = { containerWidth: 160, contentWidth: 320 };
    const observer = installWidthAndResizeMock(widths);

    const { rerender } = render(
      <MarqueeText data-testid="marquee-title">{firstLongTitle}</MarqueeText>,
    );

    const container = screen.getByTestId('marquee-title');
    expect(container).toHaveAttribute('data-overflowing', 'true');

    act(() => {
      observer.triggerResize({ containerWidth: 400, contentWidth: 320 });
    });

    expect(container).not.toHaveAttribute('data-overflowing');
    expect(screen.getByText(firstLongTitle)).not.toHaveClass(
      'nuclear-marquee-animate',
    );

    act(() => {
      observer.triggerResize({ containerWidth: 160, contentWidth: 380 });
    });

    rerender(
      <MarqueeText data-testid="marquee-title">{secondLongTitle}</MarqueeText>,
    );

    const secondContent = screen.getByText(secondLongTitle);
    expect(container).toHaveAttribute('data-overflowing', 'true');
    expect(secondContent).toHaveClass('nuclear-marquee-animate');
    expect(secondContent.style.getPropertyValue('--marquee-distance')).toBe(
      '-236px',
    );

    widths.contentWidth = 60;
    rerender(
      <MarqueeText data-testid="marquee-title">{shortTitle}</MarqueeText>,
    );

    expect(container).not.toHaveAttribute('data-overflowing');
    expect(screen.getByText(shortTitle)).not.toHaveClass(
      'nuclear-marquee-animate',
    );
  });

  it('invokes onClick and preserves an explicit title prop', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    installWidthAndResizeMock({ containerWidth: 160, contentWidth: 320 });

    render(
      <MarqueeText
        data-testid="marquee-title"
        title="Custom Tooltip"
        onClick={handleClick}
      >
        Clickable Long Song Title
      </MarqueeText>,
    );

    const container = screen.getByTestId('marquee-title');
    expect(container).toHaveAttribute('title', 'Custom Tooltip');

    await user.click(container);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});

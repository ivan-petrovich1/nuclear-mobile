import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LayoutState {
  leftSidebar: {
    isCollapsed: boolean;
    width: number;
  };
  rightSidebar: {
    isCollapsed: boolean;
    width: number;
  };
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftSidebarWidth: (width: number) => void;
  setRightSidebarWidth: (width: number) => void;
}

const isMobileViewport = () =>
  typeof window !== 'undefined' &&
  (window.innerWidth < 768 ||
    (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)));

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      leftSidebar: {
        isCollapsed: isMobileViewport(),
        width: 200,
      },
      rightSidebar: {
        isCollapsed: isMobileViewport(),
        width: 240,
      },
      toggleLeftSidebar: () =>
        set((state) => {
          const nextCollapsed = !state.leftSidebar.isCollapsed;
          return {
            leftSidebar: {
              ...state.leftSidebar,
              isCollapsed: nextCollapsed,
            },
            rightSidebar:
              !nextCollapsed && isMobileViewport()
                ? { ...state.rightSidebar, isCollapsed: true }
                : state.rightSidebar,
          };
        }),
      toggleRightSidebar: () =>
        set((state) => {
          const nextCollapsed = !state.rightSidebar.isCollapsed;
          return {
            rightSidebar: {
              ...state.rightSidebar,
              isCollapsed: nextCollapsed,
            },
            leftSidebar:
              !nextCollapsed && isMobileViewport()
                ? { ...state.leftSidebar, isCollapsed: true }
                : state.leftSidebar,
          };
        }),
      setLeftSidebarWidth: (width: number) =>
        set((state) => ({
          leftSidebar: {
            ...state.leftSidebar,
            width,
          },
        })),
      setRightSidebarWidth: (width: number) =>
        set((state) => ({
          rightSidebar: {
            ...state.rightSidebar,
            width,
          },
        })),
    }),
    {
      name: 'nuclear-layout-store',
    },
  ),
);

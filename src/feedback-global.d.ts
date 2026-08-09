declare global {
  interface Window {
    feedback?: {
      open(o?: { returnFocusTo?: HTMLElement | null; build?: string; label?: string }): void;
      mount(o?: object): void;
    };
  }
}
export {};

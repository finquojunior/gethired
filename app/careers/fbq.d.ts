// Meta Pixel global, loaded by app/careers/layout.tsx in production only
interface Window {
  fbq?: (...args: unknown[]) => void;
}

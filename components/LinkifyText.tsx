// Renders answer text with any http(s) URLs as clickable links (new tab).
// Server-safe: plain JSX, React escapes the text parts.
export default function LinkifyText({ value }: { value: unknown }) {
  const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  const parts = text.split(/(https?:\/\/[^\s,]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-pine underline"
          >
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}

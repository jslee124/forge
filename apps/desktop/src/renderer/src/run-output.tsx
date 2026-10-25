export function RunOutput({
  label,
  children,
}: {
  label: string;
  children: string;
}) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: This bounded output scroll region needs keyboard access.
    <section className="run-output" aria-label={label} tabIndex={0}>
      <pre>{children}</pre>
    </section>
  );
}

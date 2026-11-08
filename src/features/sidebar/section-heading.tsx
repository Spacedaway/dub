export function SectionHeading({children}: {children: React.ReactNode}) {
  return (
    <h2 className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

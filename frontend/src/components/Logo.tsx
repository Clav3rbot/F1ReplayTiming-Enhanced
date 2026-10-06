// The light theme swaps in /logo-light.png: the same mark in ink and red on a
// light tile with a faint waving chequered flag fading in from the top corner.
export default function Logo({ alt, className = "" }: { alt: string; className?: string }) {
  return (
    <>
      <img src="/logo.png" alt={alt} className={`light:hidden ${className}`} />
      <img src="/logo-light.png" alt={alt} className={`hidden light:block ${className}`} />
    </>
  );
}

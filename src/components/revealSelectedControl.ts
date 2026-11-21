// React attaches this ref to the selected button when a strip mounts or its selection changes.
export function revealSelectedControl(button: HTMLButtonElement | null) {
  const strip = button?.parentElement;
  if (!button || !strip) return;

  const reveal = () => {
    if (strip.scrollWidth <= strip.clientWidth) return;
    const bounds = button.getBoundingClientRect();
    const left = strip.getBoundingClientRect().left + strip.clientLeft;
    const right = left + strip.clientWidth;
    if (bounds.left < left || bounds.width > strip.clientWidth)
      strip.scrollLeft += Math.floor(bounds.left - left);
    else if (bounds.right > right)
      strip.scrollLeft += Math.ceil(bounds.right - right);
  };

  reveal();
  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(reveal);
  observer.observe(strip);
  // Text zoom can change a preceding label's width without resizing the strip.
  for (const option of strip.children) observer.observe(option);
  return () => observer.disconnect();
}

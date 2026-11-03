export function updatePointerGradient(element, event, xVariable, yVariable) {
  if (event.pointerType !== "mouse" || !element) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const bounds = element.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  element.style.setProperty(xVariable, `${((event.clientX - bounds.left) / bounds.width) * 100}%`);
  element.style.setProperty(yVariable, `${((event.clientY - bounds.top) / bounds.height) * 100}%`);
}

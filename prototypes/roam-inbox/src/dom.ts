/* Two helpers every UI module uses. */

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/* mousedown rather than click, and prevented, so focus stays where it is:
 * in the block editor for the picker, and off the panel for its buttons. */
export const onPress = (node: HTMLElement, fn: () => void): void => {
  node.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  });
};

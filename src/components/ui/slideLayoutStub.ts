const ITEM_HEIGHT = 40;
const ITEM_WIDTH = 100;

type Axis = "x" | "y";

const OFFSETS = ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"] as const;
let originals: (PropertyDescriptor | undefined)[] = [];

/** Lays `.slide-item`s out in document order so each item's offsets follow its index. */
export function stubSlideLayout(axis: Axis = "y") {
  const indexOf = (element: HTMLElement) => {
    const items = [...(element.closest(".slide-list")?.querySelectorAll(".slide-item") ?? [])];
    return items.indexOf(element);
  };
  const horizontal = axis === "x";
  originals = OFFSETS.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
  Object.defineProperties(HTMLElement.prototype, {
    offsetLeft: {
      configurable: true,
      get(this: HTMLElement) {
        return Math.max(0, indexOf(this)) * (horizontal ? ITEM_WIDTH : 0);
      },
    },
    offsetTop: {
      configurable: true,
      get(this: HTMLElement) {
        return Math.max(0, indexOf(this)) * (horizontal ? 0 : ITEM_HEIGHT);
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return indexOf(this) >= 0 ? (horizontal ? ITEM_WIDTH : 240) : 0;
      },
    },
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return indexOf(this) >= 0 ? ITEM_HEIGHT : 0;
      },
    },
  });
}

export function restoreSlideLayout() {
  OFFSETS.forEach((name, index) => {
    const descriptor = originals[index];
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  });
  originals = [];
}

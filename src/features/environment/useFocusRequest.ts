import { useEffect, useRef } from "react";

/**
 * Focuses the element the request names, once per request. The element may
 * only exist after a later render (a new row), so the check runs after every
 * commit until it has been applied.
 */
export function useFocusRequest<T extends HTMLElement>(
  request: { readonly id: number } | undefined,
) {
  const ref = useRef<T>(null);
  const applied = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (request === undefined || applied.current === request.id) return;
    if (ref.current === null) return;
    applied.current = request.id;
    ref.current.focus();
  });
  return ref;
}

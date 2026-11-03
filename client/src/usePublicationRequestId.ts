import { useRef } from "react";

/** A transport retry is the same publication intent, not another post. */
export function usePublicationRequestId() {
  const previous = useRef<{ intent: string; requestId: string } | null>(null);
  const identify = (intent: Record<string, unknown>) => {
    const signature = JSON.stringify(intent);
    if (previous.current?.intent !== signature) previous.current = { intent: signature, requestId: crypto.randomUUID() };
    return previous.current.requestId;
  };
  // A successful response ends this transport retry group. A subsequent
  // explicit approval is a new intent even if its fields happen to match.
  return Object.assign(identify, { complete: () => { previous.current = null; } });
}

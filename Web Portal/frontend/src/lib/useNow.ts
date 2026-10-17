import { useEffect, useState } from 'react';

/** The time now, refreshed every `everyMs` (for "in 25 min" and the like). */
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

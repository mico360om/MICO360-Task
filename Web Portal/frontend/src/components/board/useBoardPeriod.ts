import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { readUserValue, writeUserValue } from '../../lib/user-storage';
import { useAuthStore } from '../../stores/auth-store';
import { isMonthKey } from '../../lib/board-month';

export type BoardPeriod = 'day' | 'month';

/**
 * Day | Month (month view): the board shows one day — its date, the day picker and carry-forward, as
 * before — or one month. The month is in the address (?month=2026-11: a link opens that month) and,
 * with the choice of Day or Month, remembered for the person on this device per place (`place`: the
 * Board page's 'board', a project page's Board tab's 'project-board'), so the board opens as they left it.
 */
export function useBoardPeriod(place: string, thisMonth: string) {
  const userId = useAuthStore((s) => s.user?.id);
  const [params, setParams] = useSearchParams();
  const asked = params.get('month');
  const [saved, setSaved] = useState(() => {
    const id = useAuthStore.getState().user?.id;
    const at = readUserValue(id, `${place}.month`);
    return { inMonth: readUserValue(id, `${place}.period`) === 'month', at: isMonthKey(at) ? at : null };
  });
  // Any ?month= opens the month view (one that isn't a month: the last one viewed, else this one).
  const inMonth = asked !== null || saved.inMonth;
  const month = isMonthKey(asked) ? asked : saved.at ?? thisMonth;

  const showMonth = useCallback(
    (m: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (m) next.set('month', m);
          else next.delete('month');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  // The address always says the month shown (opened from memory, or from a ?month= that isn't one).
  useEffect(() => {
    if (inMonth && asked !== month) showMonth(month);
  }, [inMonth, asked, month, showMonth]);
  // Remember it — a month opened by a link too.
  useEffect(() => {
    if (!inMonth) return;
    writeUserValue(userId, `${place}.period`, 'month');
    writeUserValue(userId, `${place}.month`, month);
  }, [inMonth, month, place, userId]);

  const choosePeriod = (period: BoardPeriod) => {
    if (period === 'month') {
      setSaved({ inMonth: true, at: month });
      showMonth(month);
    } else {
      setSaved((s) => ({ ...s, inMonth: false }));
      writeUserValue(userId, `${place}.period`, 'day');
      showMonth(null);
    }
  };
  const chooseMonth = (m: string) => {
    setSaved({ inMonth: true, at: m });
    showMonth(m);
  };

  return { period: (inMonth ? 'month' : 'day') as BoardPeriod, month, choosePeriod, chooseMonth };
}

import type { Bar, BarSession, ScheduleAssignment, Artist } from '@/types/types';

export function exportToCSV(
  bar: Bar,
  sessions: BarSession[],
  dates: string[],
  assignments: ScheduleAssignment[],
  artists: Artist[]
): string {
  const artistMap = new Map(artists.map((a) => [a.id, a]));
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));

  const header = ['日期', '星期', ...sessions.map((s) => `${s.session_name || `第${s.session_number}节`}(${s.singers_per_session}人)`)];
  const rows: string[][] = [];

  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  for (const dateStr of dates) {
    const date = new Date(dateStr);
    const row: string[] = [dateStr, weekDays[date.getDay()]];
    for (const session of sessions) {
      const ass = assignments.filter(
        (a) => a.date === dateStr && a.session_id === session.id
      );
      const names = ass
        .map((a) => {
          if (a.external_name) return a.external_name + '(临时)';
          const art = artistMap.get(a.artist_id || '');
          return art?.name || '-';
        })
        .join(', ');
      row.push(names || '-');
    }
    rows.push(row);
  }

  let csv = '\uFEFF' + header.join(',') + '\n';
  for (const row of rows) {
    csv += row.join(',') + '\n';
  }

  return csv;
}

export function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

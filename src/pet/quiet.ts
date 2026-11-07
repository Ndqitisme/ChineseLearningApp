// Quiet hours: a daily local-time window ("22:30"–"07:00") that may cross midnight.

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function inQuietWindow(d: Date, from: string, to: string): boolean {
  const m = d.getHours() * 60 + d.getMinutes();
  const f = minutes(from), t = minutes(to);
  return f <= t ? m >= f && m < t : m >= f || m < t;
}

/** When the quiet window `d` falls in ends, epoch ms: the next `to` after `d`. */
export function quietWindowEnd(d: Date, to: string): number {
  const end = new Date(d);
  end.setHours(Math.floor(minutes(to) / 60), minutes(to) % 60, 0, 0);
  if (end.getTime() <= d.getTime()) end.setDate(end.getDate() + 1);
  return end.getTime();
}

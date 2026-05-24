import { useEffect, useState, useMemo } from 'react';
import { getBars, getBarSessions, getArtists, getArtistBarLinks, getAvailabilities, getSchedules, getAssignments } from '@/services/database';
import { isArtistAvailable } from '@/lib/schedule';
import type { Bar, BarSession, Artist, ArtistAvailability, Schedule, ScheduleAssignment } from '@/types/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Users, Phone, Check } from 'lucide-react';

export default function SubstitutionPage() {
  const [bars, setBars] = useState<Bar[]>([]);
  const [selectedBarId, setSelectedBarId] = useState('');
  const [sessions, setSessions] = useState<BarSession[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [availabilities, setAvailabilities] = useState<ArtistAvailability[]>([]);
  const [poolArtistIds, setPoolArtistIds] = useState<Set<string>>(new Set());
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedAbsentArtistId, setSelectedAbsentArtistId] = useState('');

  const bar = useMemo(() => bars.find((b) => b.id === selectedBarId), [bars, selectedBarId]);

  useEffect(() => {
    getBars().then(setBars);
  }, []);

  useEffect(() => {
    if (!selectedBarId) return;
    Promise.all([
      getBarSessions(selectedBarId),
      getArtists(),
      getArtistBarLinks(undefined, selectedBarId),
      getAvailabilities(),
      getSchedules(selectedBarId),
    ]).then(([se, a, links, avails, sc]) => {
      setSessions(se);
      setArtists(a);
      setPoolArtistIds(new Set(links.map((l) => l.artist_id)));
      setAvailabilities(avails);
      setSchedules(sc);
      if (sc.length > 0 && sc[0].is_current) {
        getAssignments(sc[0].id).then(setAssignments);
      }
    });
  }, [selectedBarId]);

  const poolSingers = artists.filter((a) => poolArtistIds.has(a.id) && a.type === 'singer');
  const externalSingers = artists.filter((a) => !poolArtistIds.has(a.id) && a.type === 'singer');

  const currentAssignments = useMemo(() => {
    if (!selectedDate || !selectedSessionId) return [];
    return assignments.filter((a) => a.date === selectedDate && a.session_id === selectedSessionId);
  }, [assignments, selectedDate, selectedSessionId]);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);

  const internalMatches = useMemo(() => {
    if (!selectedDate || !selectedSession || !bar) return [];
    const date = new Date(selectedDate);
    const styles = selectedSession.style_tags || [];
    return poolSingers.filter((artist) => {
      if (artist.id === selectedAbsentArtistId) return false;
      if (!isArtistAvailable(artist, availabilities, date, selectedSession)) return false;
      if (styles.length === 0) return true;
      return styles.some((s: string) => artist.style_tags.includes(s));
    });
  }, [poolSingers, availabilities, selectedDate, selectedSession, selectedAbsentArtistId, bar]);

  const externalMatches = useMemo(() => {
    if (!selectedDate || !selectedSession || !bar || bar.pool_type === 'closed') return [];
    const date = new Date(selectedDate);
    const styles = selectedSession.style_tags || [];
    return externalSingers.filter((artist) => {
      if (!isArtistAvailable(artist, availabilities, date, selectedSession)) return false;
      if (styles.length === 0) return true;
      return styles.some((s: string) => artist.style_tags.includes(s));
    });
  }, [externalSingers, availabilities, selectedDate, selectedSession, bar]);

  const showCount = (artistId: string) => {
    const currentSchedule = schedules.find((s) => s.is_current);
    if (!currentSchedule) return 0;
    return assignments.filter((a) => a.artist_id === artistId && a.schedule_id === currentSchedule.id).length;
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-balance">顶班匹配</h2>
        <p className="text-sm text-muted-foreground">快速匹配可顶班的歌手人选</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">酒吧</label>
              <Select value={selectedBarId} onValueChange={setSelectedBarId}>
                <SelectTrigger><SelectValue placeholder="选择酒吧" /></SelectTrigger>
                <SelectContent>
                  {bars.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">日期</label>
              <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">节次</label>
              <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
                <SelectTrigger><SelectValue placeholder="选择节次" /></SelectTrigger>
                <SelectContent>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.session_name || `第${s.session_number}节`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">请假歌手</label>
              <Select value={selectedAbsentArtistId} onValueChange={setSelectedAbsentArtistId}>
                <SelectTrigger><SelectValue placeholder="选择请假歌手" /></SelectTrigger>
                <SelectContent>
                  {currentAssignments.map((a) => {
                    const art = artists.find((x) => x.id === a.artist_id);
                    if (!art) return null;
                    return <SelectItem key={a.id} value={art.id}>{art.name}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedDate && selectedSession && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                本店可选（{internalMatches.length}人）
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {internalMatches.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无匹配人选</p>
              ) : (
                internalMatches.map((a) => (
                  <div key={a.id} className="flex items-center justify-between p-3 border border-border rounded-md">
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{a.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.style_tags.join(' / ') || '无风格标签'} · 已排{showCount(a.id)}场
                      </div>
                      {a.phone && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Phone className="h-3 w-3" /> {a.phone}
                        </div>
                      )}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => {
                      navigator.clipboard.writeText(a.phone || '');
                      toast.success('已复制联系方式');
                    }}>
                      <Check className="h-3.5 w-3.5 mr-1" />联系
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {bar?.pool_type === 'open' && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  外部可选（{externalMatches.length}人）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {externalMatches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无匹配人选</p>
                ) : (
                  externalMatches.map((a) => (
                    <div key={a.id} className="flex items-center justify-between p-3 border border-border rounded-md">
                      <div className="min-w-0">
                        <div className="font-medium text-sm">{a.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {a.style_tags.join(' / ') || '无风格标签'} · 已排{showCount(a.id)}场
                        </div>
                        {a.phone && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Phone className="h-3 w-3" /> {a.phone}
                          </div>
                        )}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => {
                        navigator.clipboard.writeText(a.phone || '');
                        toast.success('已复制联系方式');
                      }}>
                        <Check className="h-3.5 w-3.5 mr-1" />联系
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

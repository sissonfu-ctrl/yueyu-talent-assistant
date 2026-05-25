import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getBarById, getBarSessions, getSchedules, getArtists, getArtistBarLinks, getBarArtistPrices } from '@/services/database';
import type { Bar, BarSession, Schedule, Artist, BarArtistPrice, ArtistBarLink } from '@/types/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export default function BarDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [bar, setBar] = useState<Bar | null>(null);
  const [sessions, setSessions] = useState<BarSession[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [poolArtistIds, setPoolArtistIds] = useState<Set<string>>(new Set());
  const [artistBarLinks, setArtistBarLinks] = useState<ArtistBarLink[]>([]);
  const [prices, setPrices] = useState<BarArtistPrice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  async function loadData() {
    if (!id) return;
    setLoading(true);
    try {
      const [b, se, sc, a, links, pr] = await Promise.all([
        getBarById(id),
        getBarSessions(id),
        getSchedules(id),
        getArtists(),
        getArtistBarLinks(undefined, id),
        getBarArtistPrices(id),
      ]);
      setBar(b);
      setSessions(se);
      setSchedules(sc);
      setArtists(a);
      setPoolArtistIds(new Set(links.map((l) => l.artist_id)));
      setArtistBarLinks(links);
      setPrices(pr);
    } finally {
      setLoading(false);
    }
  }

  const poolArtists = artists.filter((a) => poolArtistIds.has(a.id));

  const getPreferredSessions = (artistId: string): number[] => {
    const link = artistBarLinks.find((l) => l.artist_id === artistId);
    return link?.preferred_sessions?.length ? link.preferred_sessions : [];
  };

  const getArtistPrice = (artistId: string) => {
    const p = prices.find((pr) => pr.artist_id === artistId);
    return p ? p.price_per_show : (bar?.default_price_per_show || 0);
  };

  const genericSessions = sessions.filter((s) => s.weekday === null);
  const weekdaySessions: Record<number, BarSession[]> = {};
  for (let i = 0; i <= 6; i++) {
    weekdaySessions[i] = sessions.filter((s) => s.weekday === i);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!bar) return <div className="p-4 text-muted-foreground">酒吧不存在</div>;

  return (
    <div className="space-y-4">
      {/* 返回 + 标题 */}
      <div className="flex items-center gap-2">
        <Link to="/bars">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-xl font-bold text-balance">{bar.name}</h2>
          <p className="text-sm text-muted-foreground">{bar.address || '暂无地址'}</p>
        </div>
      </div>

      {/* ── 基本信息 ── */}
      <Card>
        <CardHeader><CardTitle>基本信息</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-muted-foreground">名称：</span>{bar.name}</div>
            <div><span className="text-muted-foreground">地址：</span>{bar.address || '-'}</div>
            <div><span className="text-muted-foreground">周期：</span>{bar.schedule_cycle_type === 'weekly' ? '每周排班' : '每月排班'}</div>
            <div><span className="text-muted-foreground">歌手池：</span>{bar.pool_type === 'closed' ? '封闭型' : '开放型'}</div>
            <div><span className="text-muted-foreground">单价：</span>{bar.default_price_per_show}元/场</div>
            <div><span className="text-muted-foreground">默认节数：</span>{bar.sessions_per_night}节/晚</div>
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">休息日：</span>
            {(bar.rest_days || []).length === 0 ? '无' : (bar.rest_days || []).map(d => WEEKDAYS[d]).join('、')}
          </div>
        </CardContent>
      </Card>

      {/* ── 节次总览 ── */}
      <Card>
        <CardHeader><CardTitle>节次概览</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">通用节次</div>
            {genericSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">未配置</p>
            ) : (
              <div className="space-y-1">
                {genericSessions.map((s) => (
                  <div key={s.id} className="text-sm px-2 py-1 bg-muted/30 rounded">
                    {s.session_name || `第${s.session_number}节`} {s.start_time && s.end_time ? `${s.start_time}~${s.end_time}` : ''} · {s.singers_per_session}人 · {s.style_tags?.join(', ') || '不限'}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-2">按星期概览</div>
            <div className="space-y-1">
              {WEEKDAYS.map((label, idx) => {
                const specSessions = weekdaySessions[idx];
                const isReplace = (bar.replace_weekdays || []).includes(idx);
                const isRest = (bar.rest_days || []).includes(idx);
                if (isRest) return (
                  <div key={idx} className="flex items-center justify-between px-2 py-1.5 rounded text-sm opacity-50">
                    <span>{label}</span>
                    <span className="text-xs text-muted-foreground">休息</span>
                  </div>
                );
                if (isReplace) return (
                  <div key={idx} className="flex items-center justify-between px-2 py-1.5 rounded text-sm bg-destructive/5 border border-destructive/20">
                    <span className="font-medium">{label}</span>
                    <span className="text-xs text-destructive font-medium">覆盖（{specSessions.length}节）</span>
                  </div>
                );
                return (
                  <div key={idx} className="flex items-center justify-between px-2 py-1.5 rounded text-sm">
                    <span>{label}</span>
                    <span className="text-xs text-muted-foreground">通用{genericSessions.length}节{specSessions.length > 0 ? ` + 特殊${specSessions.length}节` : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">如需修改配置，请返回酒吧列表点击编辑按钮。</p>
          </div>
        </CardContent>
      </Card>

      {/* ── 歌手池 ── */}
      <Card>
        <CardHeader><CardTitle>歌手池（{poolArtists.length}人）</CardTitle></CardHeader>
        <CardContent>
          {poolArtists.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无歌手</p>
          ) : (
            <div className="space-y-2">
              {poolArtists.map((a) => {
                const prefSessions = getPreferredSessions(a.id);
                return (
                  <div key={a.id} className="flex items-center justify-between p-2 border rounded-md text-sm">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{a.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{a.style_tags.join(' / ') || '无风格标签'}</div>
                      {prefSessions.length > 0 && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          <span className="text-[10px] text-muted-foreground">偏好：</span>
                          {prefSessions.map((sn, idx) => (
                            <span key={sn} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                              {idx + 1}️⃣ 第{sn}节
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{getArtistPrice(a.id)}元/场</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="pt-2 border-t border-border mt-3">
            <p className="text-xs text-muted-foreground">如需管理歌手池，请返回酒吧列表点击编辑按钮。</p>
          </div>
        </CardContent>
      </Card>

      {/* ── 排班版本 ── */}
      <Card>
        <CardHeader><CardTitle>排班版本</CardTitle></CardHeader>
        <CardContent>
          {schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无排班记录</p>
          ) : (
            <div className="space-y-3">
              {schedules.map((s) => (
                <div key={s.id} className={`flex items-center justify-between p-3 border rounded-lg ${s.is_current ? 'border-primary' : ''}`}>
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{s.period_label}</div>
                    <div className="text-xs text-muted-foreground">{s.period_start} ~ {s.period_end}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.is_current && <span className="px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground">当前</span>}
                    <span className="px-2 py-0.5 text-xs rounded bg-muted">{s.status === 'published' ? '已发布' : '草稿'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBars, getArtists, getSchedules } from '@/services/database';
import type { Bar, Artist, Schedule } from '@/types/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Mic2, CalendarDays, ClipboardList, Users, History } from 'lucide-react';

export default function DashboardPage() {
  const [bars, setBars] = useState<Bar[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [b, a, s] = await Promise.all([
          getBars(),
          getArtists(),
          getSchedules(),
        ]);
        setBars(b);
        setArtists(a);
        setSchedules(s);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const singers = artists.filter((a) => a.type === 'singer');
  const musicians = artists.filter((a) => a.type === 'musician');
  const currentSchedules = schedules.filter((s) => s.is_current);

  const quickLinks = [
    { name: '酒吧管理', path: '/bars', icon: Building2, desc: `${bars.length} 家酒吧` },
    { name: '艺人管理', path: '/artists', icon: Mic2, desc: `${artists.length} 位艺人` },
    { name: '排班工作台', path: '/schedule', icon: CalendarDays, desc: `${currentSchedules.length} 份当前排班` },
    { name: '顶班匹配', path: '/substitution', icon: Users, desc: '快速替换请假艺人' },
    { name: '记账结算', path: '/settlement', icon: ClipboardList, desc: '自动核算演出费用' },
    { name: '历史排班', path: '/history', icon: History, desc: `${schedules.length} 份历史记录` },
  ];

  if (loading) {
    return <div className="text-muted-foreground">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-balance">排班总览</h2>
        <p className="text-sm text-muted-foreground mt-1">欢迎使用演艺排班管理工具</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">合作酒吧</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{bars.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">歌手</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{singers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">乐手</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{musicians.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">当前排班</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currentSchedules.length}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {quickLinks.map((link) => (
          <Link key={link.path} to={link.path} className="group">
            <Card className="h-full flex flex-col hover:border-primary transition-colors">
              <CardContent className="flex-1 flex items-start gap-4 p-5">
                <div className="p-2.5 rounded-lg bg-muted shrink-0">
                  <link.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm">{link.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1 text-pretty">{link.desc}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

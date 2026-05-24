import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  Menu, Home, Building2, Mic2, CalendarDays, Users,
  ClipboardList, History, LogOut, ChevronLeft
} from 'lucide-react';

const navItems = [
  { name: '首页', path: '/', icon: Home },
  { name: '酒吧管理', path: '/bars', icon: Building2 },
  { name: '艺人管理', path: '/artists', icon: Mic2 },
  { name: '排班工作台', path: '/schedule', icon: CalendarDays },
  { name: '顶班匹配', path: '/substitution', icon: Users },
  { name: '记账结算', path: '/settlement', icon: ClipboardList },
  { name: '历史排班', path: '/history', icon: History },
];

function SidebarContent({ onItemClick }: { onItemClick?: () => void }) {
  const location = useLocation();
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <h1 className="text-lg font-bold text-foreground">演艺排班管理</h1>
        <p className="text-xs text-muted-foreground mt-1">专业排班工具</p>
      </div>
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {navItems.map((item) => {
          const active = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={onItemClick}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.name}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-border">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span>退出登录</span>
        </Button>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const showBack = location.pathname !== '/' && location.pathname !== '/login' && location.pathname !== '/register';

  return (
    <div className="flex min-h-screen w-full">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-border bg-sidebar">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-64 bg-sidebar">
          <SidebarContent onItemClick={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-x-hidden flex flex-col">
        {/* Mobile header */}
        <header className="md:hidden flex items-center gap-2 h-14 px-4 border-b border-border bg-card shrink-0">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
          </Sheet>
          {showBack && (
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <h1 className="flex-1 min-w-0 truncate text-sm font-semibold">
            {navItems.find((n) => location.pathname === n.path || location.pathname.startsWith(n.path + '/'))?.name || ''}
          </h1>
        </header>

        {/* Desktop header */}
        <header className="hidden md:flex items-center h-14 px-6 border-b border-border bg-card shrink-0 gap-4">
          {showBack && (
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-4 w-4" />
              返回
            </Button>
          )}
          <h1 className="text-base font-semibold">
            {navItems.find((n) => location.pathname === n.path || location.pathname.startsWith(n.path + '/'))?.name || ''}
          </h1>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

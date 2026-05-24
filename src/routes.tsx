import type { ReactNode, LazyExoticComponent } from 'react';
import { lazy } from 'react';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const BarListPage = lazy(() => import('./pages/BarListPage'));
const BarDetailPage = lazy(() => import('./pages/BarDetailPage'));
const ArtistListPage = lazy(() => import('./pages/ArtistListPage'));
const ArtistEditPage = lazy(() => import('./pages/ArtistEditPage'));
const ArtistAvailabilityPage = lazy(() => import('./pages/ArtistAvailabilityPage'));
const SchedulingPage = lazy(() => import('./pages/SchedulingPage'));
const SubstitutionPage = lazy(() => import('./pages/SubstitutionPage'));
const SettlementPage = lazy(() => import('./pages/SettlementPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const NotFound = lazy(() => import('./pages/NotFound'));

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  public?: boolean;
}

export const routes: RouteConfig[] = [
  { name: '首页', path: '/', element: <DashboardPage /> },
  { name: '酒吧管理', path: '/bars', element: <BarListPage /> },
  { name: '酒吧详情', path: '/bars/:id', element: <BarDetailPage /> },
  { name: '艺人管理', path: '/artists', element: <ArtistListPage /> },
  { name: '编辑艺人', path: '/artists/:id/edit', element: <ArtistEditPage /> },
  { name: '新增艺人', path: '/artists/new', element: <ArtistEditPage /> },
  { name: '艺人档期', path: '/artists/availabilities', element: <ArtistAvailabilityPage /> },
  { name: '排班工作台', path: '/schedule', element: <SchedulingPage /> },
  { name: '顶班匹配', path: '/substitution', element: <SubstitutionPage /> },
  { name: '记账结算', path: '/settlement', element: <SettlementPage /> },
  { name: '历史排班', path: '/history', element: <HistoryPage /> },
  { name: '登录', path: '/login', element: <LoginPage />, public: true },
  { name: '注册', path: '/register', element: <RegisterPage />, public: true },
  { name: 'Not Found', path: '*', element: <NotFound />, public: true },
];

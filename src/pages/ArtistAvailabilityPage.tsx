import { useEffect, useState } from 'react';
import { getArtists, getAvailabilities, createAvailability, createArtist, updateAvailability, deleteAvailabilities, deleteAvailability, deleteAllArtistAvailabilities } from '@/services/database';
import type { Artist, ArtistAvailability } from '@/types/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, ClipboardList, Search, Trash2, ChevronDown, ChevronRight, Pencil } from 'lucide-react';

const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

interface PasteRow {
  歌手姓名: string;
  档期类型: 'fixed' | 'temporary';
  星期或日期: string;
  开始时间: string;
  结束时间: string;
  是否可排: boolean;
}

const wMap: Record<string, string> = {
  '日': '0', '天': '0', '零': '0',
  '一': '1', '1': '1',
  '二': '2', '2': '2',
  '三': '3', '3': '3',
  '四': '4', '4': '4',
  '五': '5', '5': '5',
  '六': '6', '6': '6',
};

function extractWeekday(text: string): { value: string; type: 'fixed' } | null {
  const match = text.match(/周[\s]*([一二三四五六日天1-6])/);
  if (match) {
    const ch = match[1];
    return { value: wMap[ch] || ch, type: 'fixed' };
  }
  const match2 = text.match(/星期[\s]*([一二三四五六日天1-6])/);
  if (match2) {
    const ch = match2[1];
    return { value: wMap[ch] || ch, type: 'fixed' };
  }
  const match3 = text.match(/\b([0-6])\b/);
  if (match3) {
    return { value: match3[1], type: 'fixed' };
  }
  return null;
}

function extractDate(text: string): { value: string; type: 'temporary' } | null {
  const match = text.match(/(\d{4}[\-/]\d{1,2}[\-/]\d{1,2})/);
  if (match) {
    return { value: match[1].replace(/\//g, '-'), type: 'temporary' };
  }
  return null;
}

function extractTime(text: string): { start: string; end: string } | null {
  const match = text.match(/(\d{1,2}:\d{2})\s*[-~—到至]+\s*(\d{1,2}:\d{2})/);
  if (match) {
    return { start: match[1], end: match[2] };
  }
  const single = text.match(/(\d{1,2}:\d{2})/);
  if (single) {
    return { start: single[1], end: '23:00' };
  }
  return null;
}

function smartParseLine(line: string): PasteRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Skip header
  const headerKeywords = ['歌手', '姓名', '档期', '类型', '星期', '日期', '时间', '备注'];
  const isHeader = headerKeywords.some((kw) => trimmed.includes(kw)) && !/\d{2}:\d{2}/.test(trimmed);
  if (isHeader) return null;

  // Strategy 1: Standard 3-column format (tab/comma/space separated)
  const parts = trimmed.includes('\t')
    ? trimmed.split('\t')
    : trimmed.includes(',')
      ? trimmed.split(',')
      : trimmed.split(/\s{2,}/);

  const cells = parts.map((p) => p.trim()).filter((p) => p);

  let 歌手姓名 = '';
  let 星期或日期 = '';
  let 开始时间 = '20:00';
  let 结束时间 = '23:00';

  if (cells.length >= 3) {
    歌手姓名 = cells[0];

    const wd = extractWeekday(cells[1]);
    const dt = extractDate(cells[1]);
    if (dt) 星期或日期 = dt.value;
    else if (wd) 星期或日期 = wd.value;

    const time = extractTime(cells[2]);
    if (time) {
      开始时间 = time.start;
      结束时间 = time.end;
    }
  } else {
    const dateInfo = extractDate(trimmed);
    const weekInfo = extractWeekday(trimmed);
    if (dateInfo) 星期或日期 = dateInfo.value;
    else if (weekInfo) 星期或日期 = weekInfo.value;

    const timeInfo = extractTime(trimmed);
    if (timeInfo) {
      开始时间 = timeInfo.start;
      结束时间 = timeInfo.end;
    }

    let remaining = trimmed
      .replace(/\d{4}[\-/]\d{1,2}[\-/]\d{1,2}/g, '')
      .replace(/周[\s]*[一二三四五六日天1-6]/g, '')
      .replace(/星期[\s]*[一二三四五六日天1-6]/g, '')
      .replace(/\d{1,2}:\d{2}\s*[-~—到至]+\s*\d{1,2}:\d{2}/g, '')
      .replace(/\d{1,2}:\d{2}/g, '');

    const words = remaining.trim().split(/\s+/).filter((w) => w.length >= 1);
    if (words.length > 0) 歌手姓名 = words[0];

    if (!歌手姓名) {
      const firstWord = trimmed.split(/\s+/)[0];
      if (firstWord) 歌手姓名 = firstWord;
    }
  }

  if (!歌手姓名) return null;

  return {
    歌手姓名,
    档期类型: 'temporary',
    星期或日期,
    开始时间,
    结束时间,
    是否可排: true,
  };
}

function parsePasteText(text: string): PasteRow[] {
  const lines = text.split(/\r?\n/);
  const rows: PasteRow[] = [];
  for (const line of lines) {
    const parsed = smartParseLine(line);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

export default function ArtistAvailabilityPage() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [availabilities, setAvailabilities] = useState<ArtistAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedArtistId, setSelectedArtistId] = useState('all');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogArtistId, setDialogArtistId] = useState('');
  const [editingAvailId, setEditingAvailId] = useState<string | null>(null);

  // Batch edit dialog
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [batchEditForm, setBatchEditForm] = useState<{
    availability_type: 'fixed' | 'temporary' | '';
    day_of_week: number | null;
    specific_date: string;
    available_start: string;
    available_end: string;
    is_available: boolean | null;
    note: string;
  }>({
    availability_type: '',
    day_of_week: null,
    specific_date: '',
    available_start: '',
    available_end: '',
    is_available: null,
    note: '',
  });
  const [batchEditFields, setBatchEditFields] = useState<Set<string>>(new Set());
  const [batchEditWeekDays, setBatchEditWeekDays] = useState<Set<number>>(new Set());
  const [availForm, setAvailForm] = useState<Partial<ArtistAvailability>>({
    availability_type: 'temporary',
    day_of_week: 1,
    specific_date: '',
    available_start: '20:00',
    available_end: '23:00',
    is_available: true,
    note: '',
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedArtists, setExpandedArtists] = useState<Set<string>>(new Set());

  // Paste dialog
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pastePreview, setPastePreview] = useState<PasteRow[]>([]);


  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [a, av] = await Promise.all([getArtists(), getAvailabilities()]);
      setArtists(a);
      setAvailabilities(av);
    } catch (e) {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }

  const filteredAvail = availabilities.filter((a) => {
    if (selectedArtistId !== 'all' && a.artist_id !== selectedArtistId) return false;
    if (search) {
      const artist = artists.find((ar) => ar.id === a.artist_id);
      if (!artist?.name.includes(search)) return false;
    }
    return true;
  });

  const allFilteredIds = filteredAvail.map((a) => a.id);
  const isAllSelected = filteredAvail.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (isAllSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allFilteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allFilteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedIds.size} 条档期？`)) return;
    try {
      await deleteAvailabilities(Array.from(selectedIds));
      toast.success(`已删除 ${selectedIds.size} 条档期`);
      setSelectedIds(new Set());
      loadData();
    } catch (e: any) {
      toast.error('批量删除失败：' + e.message);
    }
  };

  const handleDeleteArtistAvailabilities = async (artistId: string) => {
    if (!confirm('确定删除该歌手的所有档期？')) return;
    try {
      await deleteAllArtistAvailabilities(artistId);
      toast.success('已删除该歌手所有档期');
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredAvail.filter((a) => a.artist_id === artistId).forEach((a) => next.delete(a.id));
        return next;
      });
      loadData();
    } catch (e: any) {
      toast.error('删除失败：' + e.message);
    }
  };

  const handleDeleteSingle = async (id: string) => {
    if (!confirm('确定删除这条档期？')) return;
    try {
      await deleteAvailability(id);
      toast.success('删除成功');
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadData();
    } catch (e: any) {
      toast.error('删除失败：' + e.message);
    }
  };

  function toggleExpanded(artistId: string) {
    setExpandedArtists((prev) => {
      const next = new Set(prev);
      if (next.has(artistId)) next.delete(artistId); else next.add(artistId);
      return next;
    });
  }

  function openDialog(artistId?: string) {
    setEditingAvailId(null);
    setDialogArtistId(artistId || '');
    setAvailForm({
      availability_type: 'temporary',
      day_of_week: 1,
      specific_date: '',
      available_start: '20:00',
      available_end: '23:00',
      is_available: true,
      note: '',
    });
    setDialogOpen(true);
  }

  function openEditDialog(a: ArtistAvailability) {
    setEditingAvailId(a.id);
    setDialogArtistId(a.artist_id);
    setAvailForm({
      availability_type: a.availability_type,
      day_of_week: a.day_of_week,
      specific_date: a.specific_date ? a.specific_date.split('T')[0] : '',
      available_start: a.available_start || '20:00',
      available_end: a.available_end || '23:00',
      is_available: a.is_available,
      note: a.note || '',
    });
    setDialogOpen(true);
  }

  async function toggleAvailabilityType(id: string, newType: 'fixed' | 'temporary') {
    try {
      await updateAvailability(id, { availability_type: newType });
      loadData();
      toast.success(`已切换为${newType === 'fixed' ? '固定' : '临时'}`);
    } catch (e: any) {
      toast.error('切换失败：' + e.message);
    }
  }

  function openBatchEdit(artistId?: string) {
    const selected = artistId
      ? availabilities.filter((a) => a.artist_id === artistId)
      : availabilities.filter((a) => selectedIds.has(a.id));
    if (selected.length === 0) return;

    // Check same artist
    const artistsInSelection = new Set(selected.map((a) => a.artist_id));
    if (artistsInSelection.size > 1) {
      toast.error('批量编辑只能针对同一个歌手');
      return;
    }

    // 如果是通过歌手卡片调用的，设置 selectedIds 为该歌手所有档期
    if (artistId) {
      setSelectedIds(new Set(selected.map((s) => s.id)));
    }

    // Compute common values
    const allSameStr = (key: 'availability_type') => {
      const vals = selected.map((s) => s[key]);
      return vals.every((v) => v === vals[0]) ? vals[0] : undefined;
    };
    const allSameNum = (key: 'day_of_week') => {
      const vals = selected.map((s) => s[key]);
      return vals.every((v) => v === vals[0]) ? vals[0] : undefined;
    };
    const allSameBool = (key: 'is_available') => {
      const vals = selected.map((s) => s[key]);
      return vals.every((v) => v === vals[0]) ? vals[0] : undefined;
    };

    const typeVal = allSameStr('availability_type');
    const dowVal = allSameNum('day_of_week');
    const dateVal = selected.every((s) => s.specific_date === selected[0].specific_date) ? selected[0].specific_date : undefined;
    const startVal = selected.every((s) => s.available_start === selected[0].available_start) ? selected[0].available_start : undefined;
    const endVal = selected.every((s) => s.available_end === selected[0].available_end) ? selected[0].available_end : undefined;
    const availVal = allSameBool('is_available');
    const noteVal = selected.every((s) => s.note === selected[0].note) ? selected[0].note : undefined;

    setBatchEditForm({
      availability_type: typeVal || '',
      day_of_week: dowVal !== undefined ? dowVal : null,
      specific_date: dateVal ? dateVal.split('T')[0] : '',
      available_start: startVal || '',
      available_end: endVal || '',
      is_available: availVal !== undefined ? availVal : null,
      note: noteVal || '',
    });
    // 初始化星期复选框：当前选中的档期覆盖了哪些星期
    const existingDays = new Set<number>();
    selected.forEach((s) => {
      if (s.day_of_week !== null && s.day_of_week !== undefined) existingDays.add(s.day_of_week);
    });
    setBatchEditWeekDays(existingDays);
    setBatchEditFields(new Set());
    setBatchEditOpen(true);
  }

  async function saveBatchEdit() {
    const selected = availabilities.filter((a) => selectedIds.has(a.id));
    if (selected.length === 0) return;

    const first = selected[0];
    const artistId = first.artist_id;
    const existingDays = new Set<number>();
    selected.forEach((s) => {
      if (s.day_of_week !== null && s.day_of_week !== undefined) existingDays.add(s.day_of_week);
    });

    try {
      // 1. 删除取消勾选的星期
      for (const day of existingDays) {
        if (!batchEditWeekDays.has(day)) {
          const toDelete = selected.find((s) => s.day_of_week === day);
          if (toDelete) await deleteAvailability(toDelete.id);
        }
      }

      // 2. 更新保留的档期（如果勾选了其他字段）
      for (const day of batchEditWeekDays) {
        const record = selected.find((s) => s.day_of_week === day);
        if (record && batchEditFields.size > 0) {
          const updates: Partial<ArtistAvailability> = {};
          if (batchEditFields.has('availability_type')) {
            updates.availability_type = batchEditForm.availability_type as 'fixed' | 'temporary';
            if (updates.availability_type === 'fixed') updates.specific_date = null;
          }
          if (batchEditFields.has('available_start')) updates.available_start = batchEditForm.available_start || null;
          if (batchEditFields.has('available_end')) updates.available_end = batchEditForm.available_end || null;
          if (batchEditFields.has('is_available')) updates.is_available = batchEditForm.is_available!;
          if (batchEditFields.has('note')) updates.note = batchEditForm.note || null;
          if (Object.keys(updates).length > 0) {
            await updateAvailability(record.id, updates);
          }
        }
      }

      // 3. 创建新勾选的星期
      for (const day of batchEditWeekDays) {
        if (!existingDays.has(day)) {
          const payload: Partial<ArtistAvailability> = {
            artist_id: artistId,
            availability_type: (batchEditForm.availability_type as 'fixed' | 'temporary') || first.availability_type,
            day_of_week: day,
            specific_date: null,
            available_start: batchEditFields.has('available_start') ? (batchEditForm.available_start || null) : (first.available_start || '20:00'),
            available_end: batchEditFields.has('available_end') ? (batchEditForm.available_end || null) : (first.available_end || '23:00'),
            is_available: batchEditFields.has('is_available') ? batchEditForm.is_available! : first.is_available,
            note: batchEditFields.has('note') ? (batchEditForm.note || null) : first.note,
          };
          await createAvailability(payload as any);
        }
      }

      toast.success('批量更新完成');
      setBatchEditOpen(false);
      setSelectedIds(new Set());
      loadData();
    } catch (e: any) {
      toast.error('批量更新失败：' + e.message);
    }
  }

  async function saveAvailability() {
    if (!dialogArtistId) {
      toast.error('请选择歌手');
      return;
    }
    const payload: Partial<ArtistAvailability> = {
      ...availForm,
      artist_id: dialogArtistId,
    };
    if (availForm.availability_type === 'fixed') {
      payload.specific_date = null;
    } else {
      // temporary: 如果填了具体日期就用日期，否则用星期
      if (availForm.specific_date) {
        payload.day_of_week = null;
        payload.specific_date = availForm.specific_date.split('T')[0];
      } else {
        payload.specific_date = null;
      }
    }
    try {
      if (editingAvailId) {
        await updateAvailability(editingAvailId, payload);
        toast.success('更新成功');
      } else {
        await createAvailability(payload as any);
        toast.success('保存成功');
      }
      setDialogOpen(false);
      setEditingAvailId(null);
      loadData();
    } catch (e: any) {
      toast.error('保存失败：' + e.message);
    }
  }

  function parseAndPreview() {
    if (!pasteText.trim()) {
      toast.error('请先粘贴档期数据');
      return;
    }
    const rows = parsePasteText(pasteText);
    if (rows.length === 0) {
      toast.error('未能识别出有效数据，请检查格式');
      return;
    }
    setPastePreview(rows);
  }

  async function confirmPasteImport() {
    if (pastePreview.length === 0) return;
    try {
      // Local cache to avoid duplicate artist creation within the same import batch
      const artistCache = new Map<string, string>();
      for (const row of pastePreview) {
        let artistId = artistCache.get(row.歌手姓名);

        if (!artistId) {
          const artist = artists.find((a) => a.name === row.歌手姓名);
          if (artist?.id) {
            artistId = artist.id;
          } else {
            const created = await createArtist({
              name: row.歌手姓名,
              phone: '',
              type: 'singer',
              style_tags: [],
              fixed_bar_id: null,
            });
            artistId = created.id;
            setArtists((prev) => [...prev, created]);
          }
          artistCache.set(row.歌手姓名, artistId);
        }

        const payload: Partial<ArtistAvailability> = {
          artist_id: artistId,
          availability_type: row.档期类型,
          available_start: row.开始时间,
          available_end: row.结束时间,
          is_available: row.是否可排,
          note: '',
        };

        // 根据输入内容自动决定 day_of_week 或 specific_date，不绑定类型
        if (row.星期或日期 && /^\d{4}-\d{2}-\d{2}$/.test(row.星期或日期)) {
          payload.specific_date = row.星期或日期;
          payload.day_of_week = null;
        } else {
          payload.day_of_week = parseInt(row.星期或日期) || null;
          payload.specific_date = null;
        }

        await createAvailability(payload as any);
      }
      toast.success(`成功导入 ${pastePreview.length} 条档期`);
      setPasteDialogOpen(false);
      setPasteText('');
      setPastePreview([]);
      loadData();
    } catch (e: any) {
      toast.error('导入失败：' + e.message);
    }
  }

  function getArtistName(id: string) {
    return artists.find((a) => a.id === id)?.name || '-';
  }

  if (loading) return <div className="text-muted-foreground">加载中...</div>;

  return (
    <div className="space-y-4 pb-6">
      <div className="px-4 pt-2">
        <div className="flex flex-col gap-2">
          <div>
            <h2 className="text-lg font-bold text-balance">艺人档期管理</h2>
            <p className="text-sm text-muted-foreground">集中管理所有歌手档期，支持批量导入</p>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1 h-11 text-sm" variant="outline" onClick={() => setPasteDialogOpen(true)}>
              <ClipboardList className="h-4 w-4 mr-2" />批量粘贴
            </Button>
            <Button className="flex-1 h-11 text-sm" onClick={() => openDialog()}>
              <Plus className="h-4 w-4 mr-2" />手动添加
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索歌手姓名" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 h-11" />
        </div>
        <Select value={selectedArtistId} onValueChange={setSelectedArtistId}>
          <SelectTrigger className="h-11"><SelectValue placeholder="全部歌手" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部歌手</SelectItem>
            {artists.filter((a) => a.type === 'singer').map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredAvail.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">暂无档期配置</CardContent></Card>
      ) : (
        <div className="space-y-3 px-4">
          {/* Batch toolbar */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={isAllSelected}
                onCheckedChange={toggleSelectAll}
                aria-label="全选"
              />
              <span className="text-sm text-muted-foreground">全选</span>
              {selectedIds.size > 0 && (
                <span className="text-sm text-primary">已选 {selectedIds.size} 条</span>
              )}
            </div>
            {selectedIds.size > 0 && (
              <Button size="sm" variant="destructive" className="h-9" onClick={handleBatchDelete}>
                <Trash2 className="h-4 w-4 mr-1" />
                批量删除
              </Button>
            )}
          </div>

          {/* Grouped by artist */}
          {Array.from(
            filteredAvail.reduce((map, a) => {
              if (!map.has(a.artist_id)) map.set(a.artist_id, []);
              map.get(a.artist_id)!.push(a);
              return map;
            }, new Map<string, ArtistAvailability[]>())
          ).map(([artistId, items]) => {
            const artistName = getArtistName(artistId);
            const isExpanded = expandedArtists.has(artistId);
            const allItemIds = items.map((i) => i.id);
            const artistAllSelected = allItemIds.every((id) => selectedIds.has(id));
            const artistSomeSelected = allItemIds.some((id) => selectedIds.has(id));

            const toggleArtistSelect = () => {
              if (artistAllSelected) {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  allItemIds.forEach((id) => next.delete(id));
                  return next;
                });
              } else {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  allItemIds.forEach((id) => next.add(id));
                  return next;
                });
              }
            };

            return (
              <Card key={artistId} className="overflow-hidden">
                {/* Artist header */}
                <div
                  className="flex items-center justify-between gap-2 p-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleExpanded(artistId)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={artistAllSelected}
                        data-state={artistSomeSelected && !artistAllSelected ? 'indeterminate' : undefined}
                        onCheckedChange={toggleArtistSelect}
                        aria-label={`选择 ${artistName} 的所有档期`}
                      />
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-semibold text-sm truncate">{artistName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">({items.length} 条档期)</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        openBatchEdit(artistId);
                      }}
                      title="批量编辑该歌手档期"
                    >
                      <Pencil className="h-4 w-4 mr-1" />
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteArtistAvailabilities(artistId);
                      }}
                      title="删除该歌手所有档期"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Availability items */}
                {isExpanded && (
                  <div className="divide-y">
                    {items.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-3 p-3 hover:bg-muted/20 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Checkbox
                            checked={selectedIds.has(a.id)}
                            onCheckedChange={() => toggleSelect(a.id)}
                            aria-label={`选择档期`}
                          />
                          <div className="min-w-0">
                            <div className="text-xs text-muted-foreground">
                              {a.day_of_week !== null && a.day_of_week !== undefined
                                ? weekDays[a.day_of_week]
                                : a.specific_date || '-'} · {a.available_start}~{a.available_end}
                              · {a.is_available ? '可排' : '不可排'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Select
                            value={a.availability_type}
                            onValueChange={(v: any) => toggleAvailabilityType(a.id, v)}
                          >
                            <SelectTrigger className="h-8 w-22 px-2 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="temporary">临时</SelectItem>
                              <SelectItem value="fixed">固定</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            onClick={() => openEditDialog(a)}
                            title="编辑"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-destructive"
                            onClick={() => handleDeleteSingle(a.id)}
                            title="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Batch Edit Dialog */}
      <Sheet open={batchEditOpen} onOpenChange={setBatchEditOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto flex flex-col p-0">
          <SheetHeader className="px-4 pt-4 pb-2 border-b shrink-0">
            <SheetTitle className="text-left">批量编辑档期（共 {selectedIds.size} 条）</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {/* 星期复选框（核心：新增/删除档期） */}
            <div className="space-y-3 border rounded-lg p-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">星期覆盖（勾选即创建，取消即删除）</Label>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {weekDays.map((label, day) => (
                  <label key={day} className="flex items-center gap-2 min-h-[48px] px-2 py-1 rounded-lg border cursor-pointer hover:bg-muted transition-colors">
                    <Checkbox
                      checked={batchEditWeekDays.has(day)}
                      onCheckedChange={(checked) => {
                        setBatchEditWeekDays((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(day); else next.delete(day);
                          return next;
                        });
                      }}
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 其他字段（可选修改） */}
            <div className="space-y-1 text-xs text-muted-foreground">以下字段勾选后应用到所有保留的档期：</div>
            {[
              { key: 'artist', label: '歌手', render: (
                <div className="h-11 flex items-center px-3 rounded-md border bg-muted text-sm">
                  {(() => {
                    const first = availabilities.find((a) => selectedIds.has(a.id));
                    return artists.find((ar) => ar.id === first?.artist_id)?.name || '未知歌手';
                  })()}
                </div>
              )},
              { key: 'availability_type', label: '档期类型', render: (
                <Select value={batchEditForm.availability_type || 'fixed'} onValueChange={(v: any) => setBatchEditForm({ ...batchEditForm, availability_type: v })}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">长期固定</SelectItem>
                    <SelectItem value="temporary">临时特殊</SelectItem>
                  </SelectContent>
                </Select>
              )},
              { key: 'available_start', label: '开始时间', render: (
                <Input type="time" className="h-11" value={batchEditForm.available_start} onChange={(e) => setBatchEditForm({ ...batchEditForm, available_start: e.target.value })} />
              )},
              { key: 'available_end', label: '结束时间', render: (
                <Input type="time" className="h-11" value={batchEditForm.available_end} onChange={(e) => setBatchEditForm({ ...batchEditForm, available_end: e.target.value })} />
              )},
              { key: 'is_available', label: '是否可排', render: (
                <Select value={batchEditForm.is_available !== null ? String(batchEditForm.is_available) : 'none'} onValueChange={(v) => setBatchEditForm({ ...batchEditForm, is_available: v === 'none' ? null : v === 'true' })}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不修改</SelectItem>
                    <SelectItem value="true">可排</SelectItem>
                    <SelectItem value="false">不可排</SelectItem>
                  </SelectContent>
                </Select>
              )},
              { key: 'note', label: '备注', render: (
                <Input className="h-11" value={batchEditForm.note} onChange={(e) => setBatchEditForm({ ...batchEditForm, note: e.target.value })} />
              )},
            ].map((field: any) => (
              <div key={field.key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{field.label}</Label>
                  {field.key !== 'artist' && (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                      <Checkbox
                        checked={batchEditFields.has(field.key)}
                        onCheckedChange={(checked) => {
                          setBatchEditFields((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(field.key); else next.delete(field.key);
                            return next;
                          });
                        }}
                      />
                      修改此字段
                    </label>
                  )}
                </div>
                {field.render}
              </div>
            ))}

            <div className="pt-2">
              <Button className="w-full h-12 text-base" onClick={saveBatchEdit}>
                保存修改
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={dialogOpen} onOpenChange={setDialogOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto flex flex-col p-0">
          <SheetHeader className="px-4 pt-4 pb-2 border-b shrink-0">
            <SheetTitle className="text-left">{editingAvailId ? '编辑档期' : '添加档期'}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div className="space-y-2">
              <Label>歌手</Label>
              {editingAvailId ? (
                <div className="h-11 flex items-center px-3 rounded-md border bg-muted text-sm">
                  {artists.find((a) => a.id === dialogArtistId)?.name || '未知歌手'}
                </div>
              ) : (
                <Select value={dialogArtistId} onValueChange={setDialogArtistId}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="选择歌手" /></SelectTrigger>
                  <SelectContent>
                    {artists.filter((a) => a.type === 'singer').map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label>档期类型</Label>
              <Select value={availForm.availability_type} onValueChange={(v: any) => setAvailForm({ ...availForm, availability_type: v })}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">长期固定（每周）</SelectItem>
                  <SelectItem value="temporary">临时特殊</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* 固定档期：只显示星期 */}
            {availForm.availability_type === 'fixed' && (
              <div className="space-y-2">
                <Label>星期</Label>
                <Select value={String(availForm.day_of_week ?? 0)} onValueChange={(v) => setAvailForm({ ...availForm, day_of_week: parseInt(v) })}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {weekDays.map((d, i) => (<SelectItem key={i} value={String(i)}>{d}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {/* 临时档期：同时支持具体日期和星期（可切换） */}
            {availForm.availability_type === 'temporary' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>具体日期（精确到某一天，留空则使用下方星期）</Label>
                  <Input type="date" className="h-11" value={availForm.specific_date || ''} onChange={(e) => {
                    const val = e.target.value;
                    setAvailForm({ ...availForm, specific_date: val, day_of_week: val ? null : availForm.day_of_week });
                  }} />
                </div>
                <div className="space-y-2">
                  <Label>星期（当未指定具体日期时生效）</Label>
                  <Select value={availForm.day_of_week !== null && availForm.day_of_week !== undefined ? String(availForm.day_of_week) : 'none'} onValueChange={(v) => setAvailForm({ ...availForm, day_of_week: v === 'none' ? null : parseInt(v), specific_date: v !== 'none' ? null : availForm.specific_date })}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不指定（使用具体日期）</SelectItem>
                      {weekDays.map((d, i) => (<SelectItem key={i} value={String(i)}>{d}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>开始时间</Label><Input type="time" className="h-11" value={availForm.available_start || ''} onChange={(e) => setAvailForm({ ...availForm, available_start: e.target.value })} /></div>
              <div className="space-y-2"><Label>结束时间</Label><Input type="time" className="h-11" value={availForm.available_end || ''} onChange={(e) => setAvailForm({ ...availForm, available_end: e.target.value })} /></div>
            </div>
            <div className="flex items-center space-x-2 min-h-[48px]">
              <Checkbox id="is-avail" checked={availForm.is_available} onCheckedChange={(v) => setAvailForm({ ...availForm, is_available: v as boolean })} />
              <label htmlFor="is-avail" className="text-sm">该时段可排</label>
            </div>
            <div className="space-y-2">
              <Label>备注</Label>
              <Input className="h-11" value={availForm.note || ''} onChange={(e) => setAvailForm({ ...availForm, note: e.target.value })} />
            </div>
            <Button className="w-full h-12 text-base" onClick={saveAvailability}>保存</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Paste dialog */}
      <Sheet open={pasteDialogOpen} onOpenChange={setPasteDialogOpen}>
        <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto flex flex-col p-0">
          <SheetHeader className="px-4 pt-4 pb-2 border-b shrink-0">
            <SheetTitle className="text-left">批量粘贴档期</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {!pastePreview.length ? (
              <>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    标准格式（每行一条，可用制表符或逗号分隔）：
                  </p>
                  <div className="bg-muted rounded-lg p-3 text-xs text-muted-foreground font-mono space-y-1">
                    <div>歌手 &nbsp;&nbsp; 星期/日期 &nbsp;&nbsp; 时间</div>
                    <div>张三 &nbsp;&nbsp; 周一 &nbsp;&nbsp; 20:00~23:00</div>
                    <div>李四 &nbsp;&nbsp; 2026-06-01 &nbsp;&nbsp; 20:00~22:00</div>
                    <div>王五 &nbsp;&nbsp; 周五 &nbsp;&nbsp; 21:00~24:00</div>
                  </div>
                  <p className="text-xs text-primary">
                    支持智能解析：即使格式不标准，AI 也会自动识别歌手、日期、时间等字段
                  </p>
                </div>

                <Textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="在此粘贴档期数据..."
                  className="min-h-[200px] font-mono text-sm"
                />
                <Button className="w-full h-12 text-base" onClick={parseAndPreview}>
                  <ClipboardList className="h-5 w-5 mr-2" />
                  智能解析
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">共识别 {pastePreview.length} 条记录，歌手不存在将自动创建</p>
                <div className="space-y-2">
                  {pastePreview.map((row, idx) => {
                    const exists = artists.some((a) => a.name === row.歌手姓名);
                    const weekLabel = /\d/.test(row.星期或日期)
                      ? weekDays[parseInt(row.星期或日期) || 0] || row.星期或日期
                      : row.星期或日期;
                    return (
                      <div key={idx} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-sm truncate">{row.歌手姓名}</span>
                          {!exists && <Badge variant="outline" className="text-[10px] h-5 px-1 shrink-0">新歌手</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0">
                          {weekLabel} · {row.开始时间}~{row.结束时间}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 h-12 text-base" onClick={() => setPastePreview([])}>重新粘贴</Button>
                  <Button className="flex-1 h-12 text-base" onClick={confirmPasteImport}>确认导入</Button>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const COUNTER_LABELS: Record<string, string> = {
  waiting_preparation: 'بانتظار التجهيز',
  in_preparation: 'قيد التجهيز',
  ready_for_delivery: 'جاهز للتسليم',
  prepared_today: 'تم تجهيزه اليوم',
  delayed_preps: 'متأخر',
};

const COUNTER_LINKS: Record<string, string> = {
  waiting_preparation: '/warehouse?tab=waiting',
  in_preparation: '/warehouse?tab=in_progress',
  ready_for_delivery: '/warehouse?tab=reviewed',
};

export default function WarehouseDashboard() {
  const { token } = useAuth();
  const [counters, setCounters] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const loadCounters = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_dashboard_warehouse', { p_token: token });
      if (error) throw error;
      const map: Record<string, number> = {};
      (data || []).forEach((row: { counter: string; value: number }) => {
        map[row.counter] = Number(row.value);
      });
      setCounters(map);
    } catch (err) {
      console.error('Warehouse dashboard error:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadCounters(); }, [loadCounters]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-3">المستودع</h2>
        <div className="text-gray-400 text-sm">جاري التحميل...</div>
      </div>
    );
  }

  const counterKeys = ['waiting_preparation', 'in_preparation', 'ready_for_delivery', 'prepared_today', 'delayed_preps'];

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold mb-3">المستودع</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {counterKeys.map((key) => {
          const value = counters[key] ?? 0;
          const link = COUNTER_LINKS[key];
          const isWarning = key === 'delayed_preps' && value > 0;
          const isPositive = key === 'prepared_today' && value > 0;
          return (
            <div key={key} className={`p-3 rounded text-center ${isWarning ? 'bg-red-50' : isPositive ? 'bg-green-50' : 'bg-gray-50'}`}>
              <div className={`text-2xl font-bold ${isWarning ? 'text-red-600' : isPositive ? 'text-green-600' : 'text-gray-800'}`}>
                {value}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {link ? <a href={link} className="hover:underline">{COUNTER_LABELS[key]}</a> : COUNTER_LABELS[key]}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-left">
        <a href="/warehouse" className="text-sm text-blue-600 hover:underline">عرض الكل →</a>
      </div>
    </div>
  );
}

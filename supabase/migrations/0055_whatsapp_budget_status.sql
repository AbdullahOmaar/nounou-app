-- 4.17 تصحيحية: قيد حالة سجل إرسال واتساب كان يرفض حالة
-- blocked_budget الجديدة (0054) — توسيع القائمة بالقيمة فقط.
alter table public.whatsapp_send_log
  drop constraint whatsapp_send_log_status_check;
alter table public.whatsapp_send_log
  add constraint whatsapp_send_log_status_check
  check (status in ('blocked_kill_switch', 'blocked_not_configured',
                    'blocked_not_enabled', 'blocked_template',
                    'blocked_budget', 'queued'));

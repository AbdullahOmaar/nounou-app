import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useAuth } from '../../lib/AuthProvider'
import { invalidatePrefixes } from '../../lib/invalidate'
import * as api from './api'

const FINANCE_PREFIXES = ['invoices', 'invoice', 'child-payments', 'overdue', 'children', 'home', 'proofs']

export function useInvoices(period: string) {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  return useQuery({
    queryKey: ['invoices', nurseryId, period],
    enabled: Boolean(nurseryId),
    queryFn: () => api.listInvoices(nurseryId!, period),
  })
}

export function useInvoice(invoiceId: string | undefined) {
  return useQuery({
    queryKey: ['invoice', invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: () => api.getInvoiceBundle(invoiceId!),
  })
}

export function useOverdue() {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const isOwner = nursery.status === 'ready' && nursery.isOwner
  return useQuery({
    queryKey: ['overdue', nurseryId],
    enabled: Boolean(nurseryId && isOwner),
    queryFn: () => api.listOverdue(nurseryId!),
  })
}

export function useChildPayments(childId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['child-payments', childId],
    enabled: Boolean(childId && enabled),
    queryFn: () => api.listChildPayments(childId!),
  })
}

export function useInvoiceMutations() {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const { user } = useAuth()
  const qc = useQueryClient()
  const refresh = () => invalidatePrefixes(qc, FINANCE_PREFIXES)
  return {
    nurseryId,
    issue: useMutation({
      mutationFn: (args: { period: string; dueDate: string | null }) =>
        api.issueMonthlyInvoices(nurseryId!, args.period, args.dueDate, user?.id ?? null),
      onSuccess: refresh,
    }),
    addLine: useMutation({
      mutationFn: (args: {
        invoiceId: string
        line: Parameters<typeof api.addInvoiceLine>[2]
      }) => api.addInvoiceLine(nurseryId!, args.invoiceId, args.line),
      onSuccess: refresh,
    }),
    deleteLine: useMutation({
      mutationFn: (lineId: string) => api.deleteInvoiceLine(lineId),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: (invoiceId: string) => api.cancelInvoice(invoiceId),
      onSuccess: refresh,
    }),
    recordPayment: useMutation({
      mutationFn: (input: api.RecordPaymentInput) =>
        api.recordPayment(nurseryId!, user?.id ?? null, input),
      onSuccess: refresh,
    }),
    reversePayment: useMutation({
      mutationFn: (payment: Parameters<typeof api.reversePayment>[2]) =>
        api.reversePayment(nurseryId!, user?.id ?? null, payment),
      onSuccess: refresh,
    }),
  }
}

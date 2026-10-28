import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { ContactDto } from '../../../shared/schemas'
import { contactSchema } from '../../../shared/schemas'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState, InlineAlert, Skeleton, notifyToast } from '@/components/ui/Feedback'
import { Input } from '@/components/ui/Input'
import { BottomSheet, Modal } from '@/components/ui/Overlay'
import { api } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms'
import { shortAddress } from '@/lib/format'

export default function Contacts() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts(), retry: 0 })
  const [editing, setEditing] = useState<ContactDto | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ContactDto | null>(null)

  const del = useMutation({
    mutationFn: (id: string) => api.deleteContact(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contacts'] })
      notifyToast.success('Contact deleted')
      setDeleting(null)
    },
    onError: (e) => notifyToast.error(describeError(e)),
  })

  const contacts = list.data?.data ?? []
  return (
    <>
      <PageHeader title="Address book" right={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add</Button>} />
      {list.isLoading ? (
        <Card className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></Card>
      ) : list.error ? (
        <Card><ErrorState message={describeError(list.error)} onRetry={() => list.refetch()} retrying={list.isFetching} /></Card>
      ) : contacts.length === 0 ? (
        <Card>
          <EmptyState icon={<Users className="size-6" />} title="No contacts yet" body="Save the people you pay often, then pick them when sending." action={<Button onClick={() => setEditing('new')}>Add a contact</Button>} />
        </Card>
      ) : (
        <Card className="divide-y divide-canvas p-0">
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-4">
              <span className="grid size-11 place-items-center rounded-full bg-brand-100 font-semibold text-brand-700">{c.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{c.name}</p>
                <p className="font-mono text-xs text-ink-mute">{shortAddress(c.address, 8, 6)}</p>
              </div>
              <button type="button" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)} className="grid size-11 place-items-center rounded-xl text-ink-soft hover:bg-brand-50">
                <Pencil className="size-4" />
              </button>
              <button type="button" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)} className="grid size-11 place-items-center rounded-xl text-bad hover:bg-bad-soft">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </Card>
      )}

      {editing !== null && <ContactForm key={editing === 'new' ? 'new' : editing.id} contact={editing} onClose={() => setEditing(null)} />}
      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Delete contact?" locked={del.isPending}>
        <p className="text-sm text-ink-soft">{deleting?.name} will be removed from your address book. The address itself is unaffected.</p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" full onClick={() => setDeleting(null)} disabled={del.isPending}>Cancel</Button>
          <Button variant="danger" full loading={del.isPending} onClick={() => deleting && del.mutate(deleting.id)}>Delete</Button>
        </div>
      </Modal>
    </>
  )
}

function ContactForm({ contact, onClose }: { contact: ContactDto | 'new'; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(contact === 'new' ? '' : contact.name)
  const [address, setAddress] = useState(contact === 'new' ? '' : contact.address)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const v = validate(contactSchema, { name, address })
    if (!v.ok) return setErrors(v.errors)
    setErrors({})
    setFormError(null)
    setBusy(true)
    try {
      if (contact === 'new') await api.addContact(v.data)
      else await api.editContact(contact.id, v.data)
      await qc.invalidateQueries({ queryKey: ['contacts'] })
      notifyToast.success(contact === 'new' ? 'Contact saved' : 'Contact updated')
      onClose()
    } catch (err) {
      setErrors(serverFieldErrors(err))
      setFormError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open onClose={onClose} title={contact === 'new' ? 'Add contact' : 'Edit contact'} locked={busy}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {formError && <InlineAlert tone="bad">{formError}</InlineAlert>}
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} disabled={busy} placeholder="Ada" />
        <Input label="Wallet address" value={address} onChange={(e) => setAddress(e.target.value.trim())} error={errors.address} disabled={busy} placeholder="0x…" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <Button type="submit" full size="lg" loading={busy}>
          Save contact
        </Button>
      </form>
    </BottomSheet>
  )
}

'use client'

import { useState } from 'react'
import { usePayment, useVasp } from '@/lib/hooks'
import { StatusBadge } from '@/components/StatusBadge'
import { formatAddress, formatHash } from '@/lib/mockData'
import { PaymentStatus } from '@/lib/types'

export default function PaymentDetailPage({ params }: { params: { id: string } }) {
  const { payment, loading, error } = usePayment(params.id)
  const fromVasp = useVasp(payment?.fromVasp || '')
  const toVasp = useVasp(payment?.toVasp || '')
  const [showAttestationForm, setShowAttestationForm] = useState(false)
  const [showAdminActions, setShowAdminActions] = useState(false)

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center text-muted-foreground">Loading...</div>
        </div>
      </div>
    )
  }

  if (error || !payment) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center text-red-600">Error: Payment not found</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Payment Details</h1>
          <p className="text-muted-foreground">ID: {formatHash(payment.id)}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Payment Information</h2>
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-muted-foreground">Amount</div>
                <div className="font-mono">{payment.amount}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Status</div>
                <div className="mt-1">
                  <StatusBadge status={payment.status} type="payment" />
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Created</div>
                <div>{new Date(payment.createdAt * 1000).toLocaleString()}</div>
              </div>
              {payment.resolvedAt && (
                <div>
                  <div className="text-muted-foreground">Resolved</div>
                  <div>{new Date(payment.resolvedAt * 1000).toLocaleString()}</div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Parties</h2>
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-muted-foreground">From VASP</div>
                <div className="font-mono">{formatAddress(payment.fromVasp)}</div>
                {fromVasp.vasp && <div className="text-xs text-muted-foreground">{fromVasp.vasp.name}</div>}
              </div>
              <div>
                <div className="text-muted-foreground">To VASP</div>
                <div className="font-mono">{formatAddress(payment.toVasp)}</div>
                {toVasp.vasp && <div className="text-xs text-muted-foreground">{toVasp.vasp.name}</div>}
              </div>
              <div>
                <div className="text-muted-foreground">Beneficiary</div>
                <div className="font-mono text-xs">{formatAddress(payment.beneficiary)}</div>
              </div>
            </div>
          </div>
        </div>

        {payment.attestationHash && (
          <div className="bg-card border border-border rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">Attestation</h2>
            <div className="space-y-2 text-sm">
              <div>
                <div className="text-muted-foreground">Message Hash</div>
                <div className="font-mono">{formatHash(payment.attestationHash)}</div>
              </div>
              {payment.ivmsVersion && (
                <div>
                  <div className="text-muted-foreground">IVMS Version</div>
                  <div>{payment.ivmsVersion}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {payment.status === PaymentStatus.Pending && (
          <div className="space-y-4">
            <button
              onClick={() => setShowAttestationForm(!showAttestationForm)}
              className="w-full px-4 py-3 rounded bg-blue-600 text-white hover:opacity-90 font-medium"
            >
              {showAttestationForm ? 'Cancel' : 'Submit Attestation'}
            </button>

            {showAttestationForm && (
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-lg font-semibold mb-4">IVMS101 Attestation</h2>
                <div className="space-y-4">
                  <button
                    onClick={() => alert('Mock attestation submitted')}
                    className="w-full px-4 py-2 rounded bg-green-600 text-white hover:opacity-90"
                  >
                    Generate & Submit Hash
                  </button>
                  <p className="text-xs text-muted-foreground">
                    In a production environment, this would build an IVMS101 message, hash it with SHA256, and submit the attestation to the contract.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => setShowAdminActions(!showAdminActions)}
          className="w-full mt-4 px-4 py-3 rounded bg-muted hover:bg-muted/80 font-medium"
        >
          {showAdminActions ? 'Hide Admin Actions' : 'Show Admin Actions'}
        </button>

        {showAdminActions && (
          <div className="bg-card border border-border rounded-lg p-6 mt-4">
            <h2 className="text-lg font-semibold mb-4">Admin Actions</h2>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => alert('Mock payment released')}
                className="px-4 py-2 rounded bg-green-600 text-white hover:opacity-90"
              >
                Release Payment
              </button>
              <button
                onClick={() => alert('Mock payment rejected')}
                className="px-4 py-2 rounded bg-red-600 text-white hover:opacity-90"
              >
                Reject Payment
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

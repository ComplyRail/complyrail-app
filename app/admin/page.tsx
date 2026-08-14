'use client'

import { useState } from 'react'

export default function AdminPage() {
  const [admins, setAdmins] = useState(['0x1234...', '0x5678...'])
  const [newAdmin, setNewAdmin] = useState('')
  const [approvalThreshold, setApprovalThreshold] = useState(1)

  const handleAddAdmin = () => {
    if (newAdmin && !admins.includes(newAdmin)) {
      setAdmins([...admins, newAdmin])
      setNewAdmin('')
    }
  }

  const handleRemoveAdmin = (admin: string) => {
    setAdmins(admins.filter(a => a !== admin))
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Admin Management</h1>
          <p className="text-muted-foreground">Manage system administrators and approval settings</p>
        </div>

        {/* Admins List */}
        <div className="bg-card border border-border rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Current Admins</h2>
          <div className="space-y-2 mb-6">
            {admins.map((admin) => (
              <div key={admin} className="flex items-center justify-between bg-muted/50 p-3 rounded">
                <span className="font-mono text-sm">{admin}</span>
                <button
                  onClick={() => handleRemoveAdmin(admin)}
                  className="text-red-600 hover:text-red-700 text-sm"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {admins.length === 0 && <p className="text-muted-foreground">No admins configured</p>}
        </div>

        {/* Add Admin */}
        <div className="bg-card border border-border rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Add Admin</h2>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Admin address (0x...)"
              value={newAdmin}
              onChange={(e) => setNewAdmin(e.target.value)}
              className="flex-1 px-3 py-2 border border-border rounded bg-background text-foreground"
            />
            <button
              onClick={handleAddAdmin}
              className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
            >
              Add
            </button>
          </div>
        </div>

        {/* Approval Threshold */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Approval Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Required Approvals: {approvalThreshold} of {admins.length}
              </label>
              <input
                type="range"
                min="1"
                max={admins.length || 1}
                value={approvalThreshold}
                onChange={(e) => setApprovalThreshold(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <button className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90">
              Update Threshold
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

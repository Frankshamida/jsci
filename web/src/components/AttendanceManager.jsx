"use client";
import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const STATUSES = ['Present', 'Absent', 'Late', 'Excused'];

export default function AttendanceManager({ initialDate }) {
  const [date, setDate] = useState(initialDate || new Date().toISOString().slice(0, 10));
  const [users, setUsers] = useState([]);
  const [records, setRecords] = useState({}); // key: user_id -> { id, status, notes }
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, [date]);

  async function fetchData() {
    setLoading(true);
    // fetch users (active members)
    const { data: usersData, error: usersErr } = await supabase.from('users').select('id, firstname, lastname, ministry').order('firstname');
    if (usersErr) {
      console.error(usersErr);
      setLoading(false);
      return;
    }

    setUsers(usersData || []);

    // fetch attendance for selected date via API
    try {
      const res = await fetch(`/api/attendance?eventDate=${date}`);
      const json = await res.json();
      if (json.success) {
        const map = {};
        (json.data || []).forEach((r) => {
          map[r.user_id] = { id: r.id, status: r.status, notes: r.notes };
        });
        setRecords(map);
      } else {
        setRecords({});
      }
    } catch (e) {
      console.error(e);
      setRecords({});
    }

    setLoading(false);
  }

  function handleStatusChange(userId, value) {
    setRecords((prev) => ({ ...prev, [userId]: { ...(prev[userId] || {}), status: value } }));
  }

  function handleNotesChange(userId, value) {
    setRecords((prev) => ({ ...prev, [userId]: { ...(prev[userId] || {}), notes: value } }));
  }

  async function saveForUser(user) {
    const rec = records[user.id] || {};
    const payload = {
      userId: user.id,
      scheduleId: null,
      eventDate: date,
      status: rec.status || 'Present',
      markedBy: null,
      notes: rec.notes || null,
    };

    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setRecords((prev) => ({ ...prev, [user.id]: { id: json.data.id, status: json.data.status, notes: json.data.notes } }));
      } else {
        alert('Save failed: ' + (json.message || 'unknown'));
      }
    } catch (e) {
      console.error(e);
      alert('Save failed');
    }
  }

  async function updateRecord(user) {
    const rec = records[user.id];
    if (!rec || !rec.id) return saveForUser(user);
    try {
      const res = await fetch('/api/attendance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rec.id, status: rec.status, notes: rec.notes }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setRecords((prev) => ({ ...prev, [user.id]: { id: json.data.id, status: json.data.status, notes: json.data.notes } }));
      } else {
        alert('Update failed: ' + (json.message || 'unknown'));
      }
    } catch (e) {
      console.error(e);
      alert('Update failed');
    }
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <label>Date: <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button onClick={fetchData} disabled={loading}>Reload</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Ministry</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Notes</th>
              <th style={{ padding: 8 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {(users || []).map((u) => {
              const rec = records[u.id] || {};
              return (
                <tr key={u.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: 8 }}>{u.firstname} {u.lastname}</td>
                  <td style={{ padding: 8 }}>{u.ministry || ''}</td>
                  <td style={{ padding: 8 }}>
                    <select value={rec.status || 'Present'} onChange={(e) => handleStatusChange(u.id, e.target.value)}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 8 }}>
                    <input type="text" value={rec.notes || ''} onChange={(e) => handleNotesChange(u.id, e.target.value)} placeholder="notes" />
                  </td>
                  <td style={{ padding: 8 }}>
                    {rec.id ? (
                      <button onClick={() => updateRecord(u)}>Update</button>
                    ) : (
                      <button onClick={() => saveForUser(u)}>Save</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Supabase client for server-side use.
 * Set SUPABASE_URL and SUPABASE_SERVICE_KEY in environment to enable.
 */
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;
if (url && serviceKey) {
  supabase = createClient(url, serviceKey);
}

function isEnabled() {
  return !!supabase;
}

async function getAllFlags() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('tender_flags')
      .select('tender_number, interested, reviewed, tendered, not_interested, comment, assigned_to, reviewed_by');
    if (error) throw error;
    const out = {};
    for (const row of data || []) {
      out[row.tender_number] = {
        interested: !!row.interested,
        reviewed: !!row.reviewed,
        tendered: !!row.tendered,
        notInterested: !!row.not_interested,
        comment: row.comment || '',
        assignedTo: row.assigned_to || '',
        reviewedBy: row.reviewed_by || ''
      };
    }
    return out;
  } catch (e) {
    console.error('Supabase getAllFlags error:', e.message);
    return null;
  }
}

async function upsertFlag(tenderNumber, payload) {
  if (!supabase) return false;
  try {
    const { interested, reviewed, tendered, notInterested, comment, assignedTo, reviewedBy } = payload;
    const row = {
      tender_number: tenderNumber,
      interested: !!interested,
      reviewed: !!reviewed,
      tendered: !!tendered,
      not_interested: !!notInterested,
      comment: comment || '',
      assigned_to: assignedTo || '',
      reviewed_by: reviewedBy || '',
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase
      .from('tender_flags')
      .upsert(row, { onConflict: 'tender_number' });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('Supabase upsertFlag error:', e.message);
    return false;
  }
}

async function getAllEmployees() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('employee_group')
      .select('id, name, email, phone, employee_number, created_at')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(r => ({
      id: r.id,
      name: r.name || '',
      email: r.email || '',
      phone: r.phone || '',
      employeeNumber: r.employee_number || ''
    }));
  } catch (e) {
    console.error('Supabase getAllEmployees error:', e.message);
    return null;
  }
}

async function addEmployee(payload) {
  if (!supabase) return null;
  try {
    const { name, email, phone, employeeNumber } = payload;
    const row = {
      name: String(name || '').trim(),
      email: String(email || '').trim().toLowerCase(),
      phone: String(phone || '').trim(),
      employee_number: String(employeeNumber || '').trim()
    };
    const { data, error } = await supabase
      .from('employee_group')
      .insert(row)
      .select('id, name, email, phone, employee_number')
      .single();
    if (error) throw error;
    return { id: data.id, name: data.name, email: data.email, phone: data.phone || '', employeeNumber: data.employee_number || '' };
  } catch (e) {
    console.error('Supabase addEmployee error:', e.message);
    return null;
  }
}

async function deleteEmployee(id) {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('employee_group').delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('Supabase deleteEmployee error:', e.message);
    return false;
  }
}

module.exports = { isEnabled, getAllFlags, upsertFlag, getAllEmployees, addEmployee, deleteEmployee };

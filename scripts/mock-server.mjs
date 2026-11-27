import http from 'node:http';

const PORT = 54321;

const NURSERY_ID = '11111111-1111-4111-8111-111111111111';
const DEMO_USER_ID = 'demo-user-id';
const CLASS_ID_1 = '22222222-2222-4222-8222-222222222221';
const CLASS_ID_2 = '22222222-2222-4222-8222-222222222222';
const CLASS_ID_3 = '22222222-2222-4222-8222-222222222223';
const CHILD_ID_1 = '44444444-4444-4444-8444-444444444441';
const CHILD_ID_2 = '44444444-4444-4444-8444-444444444442';
const CHILD_ID_3 = '44444444-4444-4444-8444-444444444443';
const CHILD_ID_4 = '44444444-4444-4444-8444-444444444444';
const CHILD_ID_5 = '44444444-4444-4444-8444-444444444445';

const GUARDIAN_ID_1 = '33333333-3333-4333-8333-333333333331';
const GUARDIAN_ID_2 = '33333333-3333-4333-8333-333333333332';
const GUARDIAN_ID_3 = '33333333-3333-4333-8333-333333333333';

const now = new Date().toISOString();
const today = now.slice(0, 10);

const db = {
  users: [
    { id: DEMO_USER_ID, display_name: 'مالك تجريبي', email: 'demo@nounou-app.com' },
    { id: 'staff-user-1', display_name: 'أبلة فاطمة', email: 'fatma@nounou-app.com' }
  ],
  nurseries: [
    {
      id: NURSERY_ID,
      name: 'حضانة نونو التجريبية',
      phone: '01000000000',
      address: 'عنوان تجريبي — القاهرة',
      created_by: DEMO_USER_ID,
      logo_url: null,
      created_at: '2026-11-20T00:00:00Z',
      updated_at: '2026-11-20T00:00:00Z'
    }
  ],
  nursery_members: [
    {
      id: 'mem-1',
      nursery_id: NURSERY_ID,
      user_id: DEMO_USER_ID,
      role: 'owner',
      status: 'active',
      permissions: {},
      created_at: '2026-11-20T00:00:00Z',
      updated_at: '2026-11-20T00:00:00Z'
    },
    {
      id: 'mem-2',
      nursery_id: NURSERY_ID,
      user_id: 'staff-user-1',
      role: 'staff',
      status: 'active',
      permissions: {
        can_manage_children: true,
        can_record_attendance: true,
        can_publish_reports: true
      },
      created_at: '2026-11-20T00:00:00Z',
      updated_at: '2026-11-20T00:00:00Z'
    }
  ],
  nursery_settings: [
    {
      nursery_id: NURSERY_ID,
      weekend_days: [5, 6],
      pickup_code_enabled: true,
      daily_report_mode: 'detailed',
      brand_accent: '#4f46e5'
    }
  ],
  classes: [
    {
      id: CLASS_ID_1,
      nursery_id: NURSERY_ID,
      name: 'البراعم',
      monthly_fee: 700,
      capacity: 15,
      age_from: 2,
      age_to: 3,
      nap_enabled: true,
      sort_order: 1,
      archived_at: null
    },
    {
      id: CLASS_ID_2,
      nursery_id: NURSERY_ID,
      name: 'الزهور',
      monthly_fee: 800,
      capacity: 20,
      age_from: 3,
      age_to: 4,
      nap_enabled: true,
      sort_order: 2,
      archived_at: null
    },
    {
      id: CLASS_ID_3,
      nursery_id: NURSERY_ID,
      name: 'الفراشات',
      monthly_fee: 900,
      capacity: 20,
      age_from: 4,
      age_to: 6,
      nap_enabled: false,
      sort_order: 3,
      archived_at: null
    }
  ],
  guardians: [
    { id: GUARDIAN_ID_1, nursery_id: NURSERY_ID, full_name: 'أحمد تجريبي', phone: '01001112223', relation: 'father' },
    { id: GUARDIAN_ID_2, nursery_id: NURSERY_ID, full_name: 'سارة تجريبية', phone: '01001112224', relation: 'mother' },
    { id: GUARDIAN_ID_3, nursery_id: NURSERY_ID, full_name: 'محمود تجريبي', phone: '01001112225', relation: 'father' }
  ],
  children: [
    {
      id: CHILD_ID_1,
      nursery_id: NURSERY_ID,
      full_name: 'يوسف تجريبي',
      birth_date: '2023-06-15',
      gender: 'male',
      photo_consent: true,
      public_code: 'YUS01',
      archived_at: null
    },
    {
      id: CHILD_ID_2,
      nursery_id: NURSERY_ID,
      full_name: 'مريم تجريبية',
      birth_date: '2022-02-10',
      gender: 'female',
      photo_consent: true,
      public_code: 'MRY02',
      archived_at: null
    },
    {
      id: CHILD_ID_3,
      nursery_id: NURSERY_ID,
      full_name: 'ليان تجريبية',
      birth_date: '2023-09-01',
      gender: 'female',
      photo_consent: true,
      public_code: 'LYN03',
      archived_at: null
    },
    {
      id: CHILD_ID_4,
      nursery_id: NURSERY_ID,
      full_name: 'عمر تجريبي',
      birth_date: '2021-12-05',
      gender: 'male',
      photo_consent: false,
      public_code: 'OMR04',
      archived_at: null
    },
    {
      id: CHILD_ID_5,
      nursery_id: NURSERY_ID,
      full_name: 'نور تجريبية',
      birth_date: '2022-07-20',
      gender: 'female',
      photo_consent: true,
      public_code: 'NUR05',
      archived_at: null
    }
  ],
  guardian_children: [
    { guardian_id: GUARDIAN_ID_1, child_id: CHILD_ID_1, is_payer: true },
    { guardian_id: GUARDIAN_ID_1, child_id: CHILD_ID_2, is_payer: true },
    { guardian_id: GUARDIAN_ID_2, child_id: CHILD_ID_3, is_payer: true },
    { guardian_id: GUARDIAN_ID_3, child_id: CHILD_ID_4, is_payer: true },
    { guardian_id: GUARDIAN_ID_2, child_id: CHILD_ID_5, is_payer: true }
  ],
  pickup_persons: [
    {
      id: 'pk-1',
      nursery_id: NURSERY_ID,
      child_id: CHILD_ID_1,
      full_name: 'جدة تجريبية',
      relation: 'grandparent',
      phone: '01001112226'
    }
  ],
  enrollments: [
    { id: 'en-1', nursery_id: NURSERY_ID, child_id: CHILD_ID_1, class_id: CLASS_ID_1, status: 'active', starts_on: '2026-10-01' },
    { id: 'en-2', nursery_id: NURSERY_ID, child_id: CHILD_ID_2, class_id: CLASS_ID_2, status: 'active', starts_on: '2026-10-01' },
    { id: 'en-3', nursery_id: NURSERY_ID, child_id: CHILD_ID_3, class_id: CLASS_ID_1, status: 'active', starts_on: '2026-10-01' },
    { id: 'en-4', nursery_id: NURSERY_ID, child_id: CHILD_ID_4, class_id: CLASS_ID_3, status: 'active', starts_on: '2026-10-01' },
    { id: 'en-5', nursery_id: NURSERY_ID, child_id: CHILD_ID_5, class_id: CLASS_ID_2, status: 'active', starts_on: '2026-10-01' }
  ],
  bus_routes: [
    { id: 'br-1', nursery_id: NURSERY_ID, name: 'خط المعادي التجريبي', supervisor_member_id: 'mem-2' }
  ],
  bus_subscriptions: [
    {
      id: 'bs-1',
      nursery_id: NURSERY_ID,
      route_id: 'br-1',
      child_id: CHILD_ID_1,
      status: 'active',
      monthly_fee: 300,
      trip_type: 'round_trip',
      pickup_stop: 'محطة 1',
      dropoff_stop: 'محطة 1'
    }
  ],
  bus_day_lists: [
    { id: 'bdl-1', nursery_id: NURSERY_ID, route_id: 'br-1', list_date: today, direction: 'morning', status: 'completed' }
  ],
  bus_day_entries: [
    { id: 'bde-1', list_id: 'bdl-1', subscription_id: 'bs-1', child_id: CHILD_ID_1, status: 'present', stop_name: 'محطة 1', recorded_at: `${today}T07:45:00Z` }
  ],
  class_days: [
    { id: 'cd-1', nursery_id: NURSERY_ID, class_id: CLASS_ID_1, day_date: today },
    { id: 'cd-2', nursery_id: NURSERY_ID, class_id: CLASS_ID_2, day_date: today },
    { id: 'cd-3', nursery_id: NURSERY_ID, class_id: CLASS_ID_3, day_date: today }
  ],
  attendance: [
    {
      id: 'att-1',
      nursery_id: NURSERY_ID,
      class_day_id: 'cd-1',
      child_id: CHILD_ID_1,
      status: 'present',
      arrived_at: '08:15',
      picked_up_at: null,
      note: null
    },
    {
      id: 'att-2',
      nursery_id: NURSERY_ID,
      class_day_id: 'cd-1',
      child_id: CHILD_ID_3,
      status: 'present',
      arrived_at: '08:30',
      picked_up_at: '14:00',
      note: null
    }
  ],
  daily_reports: [
    {
      id: 'dr-1',
      nursery_id: NURSERY_ID,
      class_day_id: 'cd-1',
      child_id: CHILD_ID_1,
      meals: [
        { meal: 'breakfast', ate: 'all', source: 'home' },
        { meal: 'lunch', ate: 'most', source: 'nursery' }
      ],
      nap_from: '12:30',
      nap_to: '14:00',
      nap_slept: true,
      activities: ['تلوين بالأصابع', 'لعب مكعبات'],
      mood: 'happy',
      note: 'يوم رائع وتفاعل ممتاز مع الأصحاب.',
      published_at: `${today}T14:30:00Z`,
      created_by: DEMO_USER_ID
    }
  ],
  child_photos: [
    {
      id: 'photo-1',
      nursery_id: NURSERY_ID,
      class_day_id: 'cd-1',
      storage_path: 'demo/photo1.jpg',
      caption: 'نشاط الرسم الصباحي',
      created_at: `${today}T10:30:00Z`
    }
  ],
  photo_children: [
    { photo_id: 'photo-1', child_id: CHILD_ID_1 }
  ],
  invoices: [
    {
      id: 'inv-1',
      nursery_id: NURSERY_ID,
      child_id: CHILD_ID_1,
      guardian_id: GUARDIAN_ID_1,
      period: '2026-11',
      total_amount: 700,
      status: 'issued',
      due_date: '2026-11-30',
      created_at: '2026-11-01T08:00:00Z'
    }
  ],
  invoice_lines: [
    {
      id: 'inl-1',
      invoice_id: 'inv-1',
      description: 'اشتراك شهر نوفمبر — فصل البراعم',
      amount: 700,
      item_type: 'tuition',
      created_at: '2026-11-01T08:00:00Z'
    }
  ],
  invoice_balances: [
    {
      invoice_id: 'inv-1',
      nursery_id: NURSERY_ID,
      child_id: CHILD_ID_1,
      guardian_id: GUARDIAN_ID_1,
      period: '2026-11',
      status: 'issued',
      due_date: '2026-11-30',
      total: 700,
      paid: 700,
      balance: 0
    }
  ],
  child_balances: [
    { child_id: CHILD_ID_1, nursery_id: NURSERY_ID, balance: 0, total_paid: 700 }
  ],
  payments: [
    {
      id: 'pay-1',
      nursery_id: NURSERY_ID,
      child_id: CHILD_ID_1,
      invoice_id: 'inv-1',
      guardian_id: GUARDIAN_ID_1,
      amount: 700,
      method: 'instapay',
      receipt_no: 1,
      paid_at: '2026-11-05T12:00:00Z',
      proof_status: 'pending',
      proof_url: 'demo-proof.jpg',
      proof_path: 'proofs/demo-proof.jpg',
      proof_confirmed_at: '2026-11-05T12:05:00Z',
      source: 'portal',
      created_at: '2026-11-05T12:00:00Z'
    }
  ],
  announcements: [
    {
      id: 'ann-1',
      nursery_id: NURSERY_ID,
      title: 'إعلان الحفل السنوي التجريبي',
      body: 'يسر حضانة نونو دعوتكم لحفل الأنشطة الأسبوع القادم في مقر الحضانة.',
      published_at: '2026-11-20T10:00:00Z',
      created_at: '2026-11-20T10:00:00Z',
      created_by: DEMO_USER_ID
    }
  ],
  guardian_access_tokens: [
    {
      id: 'tok-1',
      nursery_id: NURSERY_ID,
      guardian_id: GUARDIAN_ID_1,
      child_id: CHILD_ID_1,
      token_hash: 'demo-hash',
      created_at: '2026-11-20T08:00:00Z',
      revoked_at: null
    }
  ],
  activity_log: [
    {
      id: 'act-1',
      nursery_id: NURSERY_ID,
      actor_id: DEMO_USER_ID,
      action: 'attendance_record',
      target_type: 'child',
      target_id: CHILD_ID_1,
      details: { child_name: 'يوسف تجريبي' },
      created_at: `${today}T08:15:00Z`
    }
  ],
  pickup_codes: [
    {
      id: 'pcode-1',
      nursery_id: NURSERY_ID,
      child_id: CHILD_ID_1,
      code: '9842',
      expires_at: `${today}T18:00:00Z`
    }
  ],
  child_health_profiles: [
    {
      child_id: CHILD_ID_1,
      nursery_id: NURSERY_ID,
      blood_type: 'A+',
      allergies: 'حساسية فراولة خفيفة',
      chronic_conditions: null,
      emergency_notes: 'ملاحظة طوارئ تجريبية'
    }
  ],
  medication_schedules: [],
  class_staff: [
    { class_id: CLASS_ID_1, member_id: 'mem-2' }
  ]
};

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'content-range, content-type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1:54321'}`);
  const pathname = url.pathname;

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      handleRequest(req, res, url, pathname, body);
    } catch (err) {
      console.error('Mock server error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

function handleRequest(req, res, url, pathname, body) {
  // 1. Auth routes
  if (pathname === '/auth/v1/token') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      access_token: 'fake-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'fake-refresh-token',
      user: {
        id: DEMO_USER_ID,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'demo@nounou-app.com',
        email_confirmed_at: '2026-11-20T00:00:00Z',
        user_metadata: { display_name: 'مالك تجريبي' },
        app_metadata: { provider: 'email' },
        created_at: '2026-11-20T00:00:00Z',
        updated_at: '2026-11-20T00:00:00Z'
      }
    }));
    return;
  }

  if (pathname === '/auth/v1/user') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: DEMO_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'demo@nounou-app.com',
      email_confirmed_at: '2026-11-20T00:00:00Z',
      user_metadata: { display_name: 'مالك تجريبي' },
      app_metadata: { provider: 'email' },
      created_at: '2026-11-20T00:00:00Z',
      updated_at: '2026-11-20T00:00:00Z'
    }));
    return;
  }

  if (pathname === '/auth/v1/recover') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
    return;
  }

  // 2. Storage signed URLs
  if (pathname.startsWith('/storage/v1/object/sign/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ signedUrl: 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=400' }));
    return;
  }

  // 3. RPC routes
  if (pathname.startsWith('/rest/v1/rpc/')) {
    const rpcName = pathname.replace('/rest/v1/rpc/', '');
    let parsedBody = {};
    try { parsedBody = JSON.parse(body || '{}'); } catch {}

    if (rpcName === 'claim_nursery_invites') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }
    if (rpcName === 'next_receipt_no') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(101));
      return;
    }
    if (rpcName === 'create_nursery') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(NURSERY_ID));
      return;
    }
    if (rpcName === 'nursery_portal_overview_by_token') {
      if (parsedBody.p_token && parsedBody.p_token.includes('invalid')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Invalid token' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        nursery: { name: 'حضانة نونو التجريبية', phone: '01000000000' },
        guardian: { full_name: 'أحمد تجريبي' },
        children: [
          {
            id: CHILD_ID_1,
            full_name: 'يوسف تجريبي',
            photo_consent: true,
            class_name: 'البراعم',
            balance: 0,
            total_paid: 700
          },
          {
            id: CHILD_ID_2,
            full_name: 'مريم تجريبية',
            photo_consent: true,
            class_name: 'الزهور',
            balance: 0,
            total_paid: 800
          }
        ],
        announcements: [
          {
            id: 'ann-1',
            title: 'إعلان الحفل السنوي التجريبي',
            body: 'يسر حضانة نونو دعوتكم لحفل الأنشطة الأسبوع القادم في مقر الحضانة.',
            published_at: '2026-11-20T10:00:00Z'
          }
        ]
      }));
      return;
    }
    if (rpcName === 'nursery_portal_child_day_by_token') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        attendance: {
          status: 'present',
          arrived_at: '08:15',
          picked_up_at: null,
          picked_up_by_name: null
        },
        report: {
          meals: [
            { meal: 'breakfast', ate: 'all', source: 'home' },
            { meal: 'lunch', ate: 'most', source: 'nursery' }
          ],
          nap_from: '12:30',
          nap_to: '14:00',
          nap_slept: true,
          activities: ['تلوين بالأصابع', 'لعب مكعبات'],
          mood: 'happy',
          note: 'يوم رائع وتفاعل ممتاز مع الأصحاب.',
          published_at: `${today}T14:30:00Z`
        },
        photos: [
          {
            id: 'photo-1',
            caption: 'نشاط الرسم الصباحي',
            created_at: `${today}T10:30:00Z`
          }
        ],
        invoices: [
          {
            id: 'inv-1',
            period: '2026-11',
            total: 700,
            paid: 700,
            balance: 0
          }
        ],
        proofs: [
          {
            id: 'pay-1',
            amount: 700,
            method: 'instapay',
            proof_status: 'pending',
            rejection_reason: null,
            created_at: '2026-11-05T12:00:00Z'
          }
        ],
        pickup_code: '9842'
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
    return;
  }

  // 4. REST Table queries
  if (pathname.startsWith('/rest/v1/')) {
    const tableName = pathname.replace('/rest/v1/', '').split('?')[0];
    let data = db[tableName] ? [...db[tableName]] : [];

    // Special table joins / handling
    if (tableName === 'nursery_members') {
      data = data.map(m => ({
        ...m,
        nursery: db.nurseries.find(n => n.id === m.nursery_id)
      }));
    }

    // Apply URL filters
    for (const [key, val] of url.searchParams.entries()) {
      if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset') continue;

      if (val.startsWith('eq.')) {
        const v = val.replace('eq.', '');
        data = data.filter(row => String(row[key]) === v);
      } else if (val.startsWith('in.(')) {
        const raw = val.slice(4, -1);
        const set = new Set(raw.split(',').map(s => s.trim().replace(/^"/, '').replace(/"$/, '')));
        data = data.filter(row => set.has(String(row[key])));
      } else if (val === 'is.null') {
        data = data.filter(row => row[key] === null || row[key] === undefined);
      } else if (val === 'not.is.null') {
        data = data.filter(row => row[key] !== null && row[key] !== undefined);
      }
    }

    const isSingle = (req.headers.accept || '').includes('vnd.pgrst.object+json') ||
      url.searchParams.get('limit') === '1' && (req.headers.prefer || '').includes('return=representation');

    const totalCount = data.length;
    res.setHeader('content-range', `0-${Math.max(0, totalCount - 1)}/${totalCount}`);

    if (req.method === 'HEAD') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (isSingle) {
      if (data.length === 0) {
        res.writeHead(406, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'JSON object requested, multiple (or no) rows returned' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data[0]));
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock Supabase server listening on http://127.0.0.1:${PORT}`);
});

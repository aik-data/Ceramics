// Sample data for demo mode.
const img = (n) => `img/demo/${n}.svg`;
const day = 86400000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const dateOnly = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

export function seedDemo() {
  const pieces = [
    ["p1", "Speckled Seafoam Vase", "Maya Robinson", "Wheel-thrown stoneware with a speckled seafoam glaze. Holds water — perfect for fresh flowers.", "Vases", 4000, 1, "speckled-vase"],
    ["p2", "Ocean Serving Bowl", "Leo Martinez", "A wide bowl glazed in deep ocean blue, big enough for salad or fruit.", "Bowls", 3500, 1, "ocean-bowl"],
    ["p3", "Honey Glaze Mug", "Ms. Patel's 3rd Grade", "A class set of hand-built mugs in warm honey glaze. Each is slightly different. Food safe.", "Mugs", 1500, 8, "honey-mug"],
    ["p4", "Sage Dessert Plate", "Ava Chen", "Soft sage green with a satin finish. A small plate for cookies or a candle.", "Plates", 2000, 1, "sage-plate"],
    ["p5", "Rose Bud Vase", "Sofia Nguyen", "A slender bud vase in blush pink — sized for a single stem.", "Vases", 1800, 1, "rose-bud-vase"],
    ["p6", "Terracotta Planter", "Noah Williams", "Unglazed terracotta planter with a drainage hole. Comes with a cutting from the school garden.", "Planters", 2500, 1, "terracotta-planter"],
    ["p7", "Midnight Tumbler", "Ethan Brooks", "A tall tumbler in glossy midnight blue. Great for pens, brushes or iced tea.", "Mugs", 2000, 1, "midnight-tumbler"],
    ["p8", "Lidded Treasure Jar", "Isabella Garcia", "A small jar with a fitted lid, made for keepsakes.", "Jars & dishes", 3000, 1, "lidded-jar"],
    ["p9", "Celadon Pitcher", "Liam O'Connor", "A pouring pitcher with a pulled spout and a pale celadon glaze.", "Pitchers", 4500, 1, "celadon-pitcher"],
    ["p10", "Sunshine Ring Dish", "Art Club", "Little ring dishes in sunny yellow, made by the after-school Art Club.", "Jars & dishes", 1000, 12, "ring-dish"],
    ["p11", "Cloud Bowl", "Zoe Thompson", "A matte white bowl with a soft, cloud-like rim.", "Bowls", 2500, 1, "cloud-bowl"],
    ["p12", "Forest Mug", "Mason Lee", "A sturdy mug in forest green with a comfortable thumb rest.", "Mugs", 2200, 1, "forest-mug"],
  ].map(([id, title, artist, description, category, suggested_cents, quantity, pic], i) => ({
    id, title, artist, description, category, suggested_cents, quantity, photos: [img(pic)], hidden: false, sort: i,
    created_at: iso(-10 * day + i * 1000),
  }));

  const pickupOptions = [
    { id: "pu1", label: "Spring Concert", pickup_date: dateOnly(16), start_time: "18:00", end_time: "19:30", location: "School gym lobby", note: "", active: true, sort: 0 },
    { id: "pu2", label: "Front office pickup", pickup_date: dateOnly(17), start_time: "14:30", end_time: "15:30", location: "Main office", note: "", active: true, sort: 1 },
    { id: "pu3", label: "Send home with my student", pickup_date: null, start_time: null, end_time: null, location: "", note: "Wrapped and sent home in the student's backpack", active: true, sort: 2 },
  ];

  const item = (p, qty = 1) => {
    const pc = pieces.find((x) => x.id === p);
    return { id: `oi-${p}-${Math.random().toString(36).slice(2, 7)}`, piece_id: p, qty, suggested_cents: pc.suggested_cents, title: pc.title, artist: pc.artist, released: false };
  };
  const base = { phone: "", notes: "", invoice_sent_at: null, paid_at: null, amount_received_cents: null, released_at: null };
  const orders = [
    { ...base, id: "o5", order_no: "CER-1005", created_at: iso(-0.05 * day), parent_name: "Jordan Kim", email: "jordan.kim@example.com", phone: "555-0142",
      student_name: "Riley Kim", student_class: "Mr. Alvarez, Grade 2", pickup_option_id: "pu1", pickup_label: "Spring Concert", status: "new", seen_at: null,
      notes: "Could the mug be wrapped as a gift?", order_items: [item("p3", 2), item("p5")] },
    { ...base, id: "o4", order_no: "CER-1004", created_at: iso(-0.6 * day), parent_name: "Priya Shah", email: "priya.shah@example.com",
      student_name: "Anika Shah", student_class: "Ms. Patel, Grade 3", pickup_option_id: "pu3", pickup_label: "Send home with my student", status: "new", seen_at: null,
      order_items: [item("p10", 3)] },
    { ...base, id: "o3", order_no: "CER-1003", created_at: iso(-3.5 * day), parent_name: "Chris Morgan", email: "cmorgan@example.com",
      student_name: "Ella Morgan", student_class: "Mrs. Lee, Grade 5", pickup_option_id: "pu2", pickup_label: "Front office pickup", status: "invoice_sent",
      seen_at: iso(-3.4 * day), invoice_sent_at: iso(-3 * day), order_items: [item("p9")] },
    { ...base, id: "o2", order_no: "CER-1002", created_at: iso(-1.2 * day), parent_name: "Dana Lopez", email: "dana.lopez@example.com",
      student_name: "Mateo Lopez", student_class: "Mr. Alvarez, Grade 2", pickup_option_id: "pu1", pickup_label: "Spring Concert", status: "invoice_sent",
      seen_at: iso(-1.1 * day), invoice_sent_at: iso(-1 * day), order_items: [item("p2")] },
    { ...base, id: "o1", order_no: "CER-1001", created_at: iso(-5 * day), parent_name: "Sam Rivera", email: "sam.rivera@example.com",
      student_name: "Lucy Rivera", student_class: "Ms. Patel, Grade 3", pickup_option_id: "pu1", pickup_label: "Spring Concert", status: "paid",
      seen_at: iso(-4.9 * day), invoice_sent_at: iso(-4.8 * day), paid_at: iso(-4 * day), amount_received_cents: 6000, order_items: [item("p1"), item("p3")] },
  ];

  return {
    settings: {
      fundraiser_name: "Student Ceramics Sale",
      school_name: "Lincoln Elementary",
      intro: "Every piece in this gallery was made by hand by one of our student artists. Your purchase supports art supplies, clay and kiln time for next year's classes.",
      goal_cents: 250000,
      sale_opens_at: iso(-2 * day),
      sale_closes_at: iso(14 * day),
      checkout_paused: false,
      overdue_hours: 48,
      donate_url: "https://www.futurefund.com/",
      notify_emails: ["admin@example.org"],
      expenses_cents: 0,
    },
    familyPassword: null,
    nextOrderNo: 1006,
    pieces,
    pickupOptions,
    orders,
    donations: [
      { id: "d1", amount_cents: 5000, donated_on: dateOnly(-3), name: "The Okafor family", note: "", created_at: iso(-3 * day) },
      { id: "d2", amount_cents: 2500, donated_on: dateOnly(-1), name: "", note: "Anonymous", created_at: iso(-1 * day) },
    ],
    activity: [
      { id: "a1", at: iso(-4 * day), admin_email: "admin@example.org", order_id: "o1", action: "Marked paid", detail: "$60.00" },
      { id: "a2", at: iso(-4.8 * day), admin_email: "admin@example.org", order_id: "o1", action: "Invoice sent", detail: "" },
      { id: "a3", at: iso(-3 * day), admin_email: "admin@example.org", order_id: "o3", action: "Invoice sent", detail: "" },
      { id: "a4", at: iso(-1 * day), admin_email: "admin@example.org", order_id: "o2", action: "Invoice sent", detail: "" },
    ],
    admins: [{ user_id: "demo-admin", email: "admin@example.org", created_at: iso(-10 * day) }],
  };
}
